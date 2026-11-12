import type { Pool, PoolClient, QueryResultRow } from "pg";
import {
  assertExpertIntention,
  assertExpertProvider,
  type ExpertIntention,
} from "./expert-definitions.js";
import type { LlmConfigurationRepository } from "./llm-configuration-repository.js";
import type {
  SaveLlmConfiguration,
  StoredLlmConfiguration,
} from "./llm-configuration.js";

type ConfigurationRow = QueryResultRow & {
  installation_id: string;
  provider: string;
  model: string;
  encrypted_api_key: string;
  encryption_iv: string;
  encryption_auth_tag: string;
  key_last_four: string;
  base_url: string | null;
  created_by_github_user_id: string;
  updated_by_github_user_id: string;
  created_at: Date;
  updated_at: Date;
};

const COLUMNS = `installation_id, provider, model, encrypted_api_key,
  encryption_iv, encryption_auth_tag, key_last_four, base_url,
  created_by_github_user_id, updated_by_github_user_id, created_at, updated_at`;

function mapRow(
  row: ConfigurationRow,
  intention: ExpertIntention,
): StoredLlmConfiguration {
  assertExpertProvider(intention, row.provider);
  return {
    installationId: Number(row.installation_id),
    provider: row.provider,
    model: row.model,
    encryptedApiKey: {
      ciphertext: row.encrypted_api_key,
      iv: row.encryption_iv,
      authTag: row.encryption_auth_tag,
    },
    keyLastFour: row.key_last_four,
    baseUrl: row.base_url ?? undefined,
    createdByGithubUserId: Number(row.created_by_github_user_id),
    updatedByGithubUserId: Number(row.updated_by_github_user_id),
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
  };
}

async function recordAudit(
  client: PoolClient,
  installationId: number,
  intention: ExpertIntention,
  action: "created" | "updated" | "deleted",
  githubUserId: number | undefined,
  provider: string,
  model: string,
): Promise<void> {
  await client.query(
    `INSERT INTO expert_llm_configuration_audits
      (installation_id, intention, action, provider, model, github_user_id)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [installationId, intention, action, provider, model, githubUserId ?? null],
  );
}

// L'intention est liée au repository, ce qui permet de réutiliser le service
// LLM existant sans modifier le stockage ni les appels du classifieur.
export class PostgresExpertConfigurationRepository implements LlmConfigurationRepository {
  // Nettoyage de toutes les intentions, y compris d'anciens experts retirés
  // du registre. La suppression et ses audits sont une seule requête atomique.
  static async deleteForInstallation(
    pool: Pool,
    installationId: number,
    githubUserId?: number,
  ): Promise<number> {
    const result = await pool.query<{ deleted_count: number }>(
      `WITH deleted AS (
         DELETE FROM expert_llm_configurations
         WHERE installation_id = $1
         RETURNING installation_id, intention, provider, model
       ), audited AS (
         INSERT INTO expert_llm_configuration_audits
           (installation_id, intention, action, provider, model, github_user_id)
         SELECT installation_id, intention, 'deleted', provider, model, $2
         FROM deleted
         RETURNING id
       )
       SELECT COUNT(*)::integer AS deleted_count FROM audited`,
      [installationId, githubUserId ?? null],
    );
    return result.rows[0].deleted_count;
  }

  constructor(
    private readonly pool: Pool,
    private readonly intention: ExpertIntention,
  ) {
    assertExpertIntention(intention);
  }

  async findByInstallationId(
    installationId: number,
  ): Promise<StoredLlmConfiguration | null> {
    const result = await this.pool.query<ConfigurationRow>(
      `SELECT ${COLUMNS} FROM expert_llm_configurations
       WHERE installation_id = $1 AND intention = $2`,
      [installationId, this.intention],
    );
    return result.rows[0] ? mapRow(result.rows[0], this.intention) : null;
  }

  async upsert(input: SaveLlmConfiguration): Promise<StoredLlmConfiguration> {
    assertExpertProvider(this.intention, input.provider);
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const values = [
        input.installationId,
        this.intention,
        input.provider,
        input.model,
        input.encryptedApiKey.ciphertext,
        input.encryptedApiKey.iv,
        input.encryptedApiKey.authTag,
        input.keyLastFour,
        input.baseUrl ?? null,
        input.createdByGithubUserId,
        input.updatedByGithubUserId,
      ];
      // L'insertion décide du type d'audit, même si deux créations arrivent
      // simultanément. Évite un SELECT préalable sujet aux courses.
      let result = await client.query<ConfigurationRow>(
        `INSERT INTO expert_llm_configurations
          (installation_id, intention, provider, model, encrypted_api_key,
           encryption_iv, encryption_auth_tag, key_last_four, base_url,
           created_by_github_user_id, updated_by_github_user_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
         ON CONFLICT (installation_id, intention) DO NOTHING
         RETURNING ${COLUMNS}`,
        values,
      );
      const created = result.rows.length > 0;
      if (!created) {
        result = await client.query<ConfigurationRow>(
          `UPDATE expert_llm_configurations SET
             provider = $3, model = $4, encrypted_api_key = $5,
             encryption_iv = $6, encryption_auth_tag = $7,
             key_last_four = $8, base_url = $9,
             updated_by_github_user_id = $10, updated_at = NOW()
           WHERE installation_id = $1 AND intention = $2
           RETURNING ${COLUMNS}`,
          [...values.slice(0, 9), input.updatedByGithubUserId],
        );
      }
      if (!result.rows[0]) {
        throw new Error(
          "La configuration a été supprimée pendant la sauvegarde.",
        );
      }
      const stored = mapRow(result.rows[0], this.intention);
      await recordAudit(
        client,
        input.installationId,
        this.intention,
        created ? "created" : "updated",
        input.updatedByGithubUserId,
        stored.provider,
        stored.model,
      );
      await client.query("COMMIT");
      return stored;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async delete(
    installationId: number,
    githubUserId?: number,
  ): Promise<boolean> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const result = await client.query<{ provider: string; model: string }>(
        `DELETE FROM expert_llm_configurations
         WHERE installation_id = $1 AND intention = $2
         RETURNING provider, model`,
        [installationId, this.intention],
      );
      if (result.rows[0]) {
        await recordAudit(
          client,
          installationId,
          this.intention,
          "deleted",
          githubUserId,
          result.rows[0].provider,
          result.rows[0].model,
        );
      }
      await client.query("COMMIT");
      return result.rows.length > 0;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }
}
