import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: ["src/components/atomic-crm/misc/formatPhoneToE164.test.ts"],
  },
});
