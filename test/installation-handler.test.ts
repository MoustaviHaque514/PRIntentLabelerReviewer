import { beforeEach, describe, expect, it, vi } from "vitest";
import { handleInstallationDeleted } from "../src/handlers/installation-handler.js";
import { getLlmConfigurationService } from "../src/configuration/runtime.js";
import { getExpertConfigurationService } from "../src/configuration/expert-configuration-runtime.js";
import app from "../src/index.js";

vi.mock("../src/configuration/runtime.js", () => ({
  getLlmConfigurationService: vi.fn(),
}));
vi.mock("../src/configuration/expert-configuration-runtime.js", () => ({
  getExpertConfigurationService: vi.fn(),
}));
const deleteClassifier = vi.fn();
const deleteExperts = vi.fn();
function context() {
  return {
    payload: { installation: { id: 42 } },
    log: { info: vi.fn(), error: vi.fn() },
  };
}
beforeEach(() => {
  deleteClassifier.mockReset().mockResolvedValue(true);
  deleteExperts.mockReset().mockResolvedValue(3);
  vi.mocked(getLlmConfigurationService)
    .mockReset()
    .mockReturnValue({ delete: deleteClassifier } as unknown as NonNullable<
      ReturnType<typeof getLlmConfigurationService>
    >);
  vi.mocked(getExpertConfigurationService)
    .mockReset()
    .mockReturnValue({
      deleteForInstallation: deleteExperts,
    } as unknown as ReturnType<typeof getExpertConfigurationService>);
});

describe("désinstallation", () => {
  it("branche le nettoyage sur l'événement installation.deleted", async () => {
    const on = vi.fn();
    app(
      { on, log: { info: vi.fn() } } as unknown as Parameters<typeof app>[0],
      {},
    );
    const callback = on.mock.calls.find(
      ([event]) => event === "installation.deleted",
    )?.[1];
    expect(callback).toBeTypeOf("function");
    await callback(context());
    expect(deleteClassifier).toHaveBeenCalledWith(42);
    expect(deleteExperts).toHaveBeenCalledWith(42);
  });

  it.each(["absent", "initialisation", "suppression"])(
    "nettoie les experts même si le classifieur échoue : %s",
    async (failure) => {
      if (failure === "absent")
        vi.mocked(getLlmConfigurationService).mockReturnValue(null);
      else if (failure === "initialisation")
        vi.mocked(getLlmConfigurationService).mockImplementation(() => {
          throw new Error("fake-secret");
        });
      else deleteClassifier.mockRejectedValue(new Error("fake-secret"));
      const ctx = context();
      await handleInstallationDeleted(
        ctx as unknown as Parameters<typeof handleInstallationDeleted>[0],
      );
      expect(deleteExperts).toHaveBeenCalledWith(42);
      expect(ctx.log.info).toHaveBeenCalledWith(
        { installationId: 42, deletedCount: 3 },
        "Deleted expert configurations for uninstalled app",
      );
      expect(JSON.stringify(ctx.log.error.mock.calls)).not.toContain(
        "fake-secret",
      );
    },
  );

  it("isole aussi un échec du nettoyage des experts et ne journalise aucun secret", async () => {
    deleteExperts.mockRejectedValue(new Error("fake-sensitive-db-detail"));
    const ctx = context();
    await expect(
      handleInstallationDeleted(
        ctx as unknown as Parameters<typeof handleInstallationDeleted>[0],
      ),
    ).resolves.toBeUndefined();
    expect(deleteClassifier).toHaveBeenCalledWith(42);
    expect(ctx.log.error).toHaveBeenCalledWith(
      { installationId: 42 },
      "Failed to delete expert configurations after uninstall",
    );
    expect(JSON.stringify(ctx.log.error.mock.calls)).not.toContain(
      "fake-sensitive",
    );
  });
});
