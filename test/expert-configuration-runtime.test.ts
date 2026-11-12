import type { Pool } from "pg";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getDatabasePool } from "../src/database/pool.js";
import {
  getExpertConfigurationService,
  resetExpertConfigurationServiceForTests,
} from "../src/configuration/expert-configuration-runtime.js";
import { ExpertConfigurationUnavailableError } from "../src/configuration/expert-configuration.js";

vi.mock("../src/database/pool.js", () => ({ getDatabasePool: vi.fn() }));

const query = vi.fn();
beforeEach(() => {
  resetExpertConfigurationServiceForTests();
  vi.stubEnv("CONFIG_ENCRYPTION_KEY", Buffer.alloc(32, 5).toString("base64"));
  query.mockReset().mockResolvedValue({ rows: [] });
  vi.mocked(getDatabasePool)
    .mockReset()
    .mockReturnValue({ query } as unknown as Pool);
});
afterEach(() => {
  resetExpertConfigurationServiceForTests();
  vi.unstubAllEnvs();
});

describe("runtime de configuration des experts", () => {
  it("branche la suppression globale sur le repository PostgreSQL", async () => {
    query.mockResolvedValueOnce({ rows: [{ deleted_count: 2 }] });
    expect(
      await getExpertConfigurationService().deleteForInstallation(42),
    ).toBe(2);
    expect(query).toHaveBeenCalledWith(
      expect.stringContaining("WITH deleted AS"),
      [42, null],
    );
  });

  it("construit le service sans requête et ne met pas les résultats en cache", async () => {
    const service = getExpertConfigurationService();
    expect(getExpertConfigurationService()).toBe(service);
    expect(query).not.toHaveBeenCalled();
    expect(getDatabasePool).toHaveBeenCalledOnce();
    expect(await service.resolve(42, "bug")).toBeNull();
    expect(await service.resolve(42, "bug")).toBeNull();
    expect(query).toHaveBeenCalledTimes(2);
    expect(query).toHaveBeenLastCalledWith(expect.any(String), [42, "bug"]);
  });

  it.each(["", "invalid-base64-key"])(
    "signale une clé maîtresse absente ou invalide",
    (key) => {
      vi.stubEnv("CONFIG_ENCRYPTION_KEY", key);
      expect(() => getExpertConfigurationService()).toThrow(
        ExpertConfigurationUnavailableError,
      );
      expect(getDatabasePool).not.toHaveBeenCalled();
    },
  );

  it("distingue une base non configurée d'une configuration d'expert absente", () => {
    vi.mocked(getDatabasePool).mockReturnValue(null);
    expect(() => getExpertConfigurationService()).toThrow(
      ExpertConfigurationUnavailableError,
    );
  });

  it("ne cache pas une initialisation échouée et ne propage pas ses détails", () => {
    vi.mocked(getDatabasePool).mockImplementationOnce(() => {
      throw new Error("connection string with fake-secret");
    });
    expect(() => getExpertConfigurationService()).toThrow(
      "service de configuration des experts est indisponible",
    );
    expect(() => getExpertConfigurationService()).not.toThrow();
  });

  it("signale les erreurs de lecture au lieu de revenir à Gemini ou à null", async () => {
    query.mockRejectedValue(new Error("database unavailable"));
    await expect(
      getExpertConfigurationService().resolve(42, "bug"),
    ).rejects.toThrow("Impossible de résoudre");
  });
});
