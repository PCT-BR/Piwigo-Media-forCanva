import "dotenv/config";

import fs from "fs";
import path from "path";

type CliArgs = {
  useHttps: boolean;
  preview: boolean;
  overrideFrontendPort?: number;
};

type EnvVars = {
  frontendPort: number;
  hmrEnabled: boolean;
  appId?: string;
  appOrigin?: string;
};

export class Context {
  private readonly envVars: EnvVars;

  constructor(
    private env: NodeJS.ProcessEnv = process.env,
    private readonly args: CliArgs,
  ) {
    this.envVars = this.parseAndValidateEnvironmentVariables();
  }

  static get srcDir() {
    const src = path.join(Context.rootDir, "src");

    if (!fs.existsSync(src)) {
      throw new Error(`Directory does not exist: ${src}`);
    }

    return src;
  }

  static get readmeDir() {
    return path.join(Context.rootDir, "README.md");
  }

  get entryDir() {
    return Context.srcDir;
  }

  get hmrEnabled() {
    return this.envVars.hmrEnabled;
  }

  get httpsEnabled() {
    return this.args.useHttps;
  }

  get frontendEntryPath() {
    const frontendEntryPath = path.join(this.entryDir, "index.tsx");

    if (!fs.existsSync(frontendEntryPath)) {
      throw new Error(
        `Entry point for frontend does not exist: ${frontendEntryPath}`,
      );
    }

    return frontendEntryPath;
  }

  get frontendUrl() {
    return `${this.protocol}://localhost:${this.frontendPort}`;
  }

  get frontendPort() {
    return this.args.overrideFrontendPort || this.envVars.frontendPort;
  }

  get appOrigin(): string | undefined {
    return this.envVars.appOrigin;
  }

  get appId(): string | undefined {
    return this.envVars.appId;
  }

  get openPreview(): boolean {
    return this.args.preview;
  }

  private get protocol(): "https" | "http" {
    return this.httpsEnabled ? "https" : "http";
  }

  private static get rootDir() {
    return path.join(__dirname, "..", "..");
  }

  private parseAndValidateEnvironmentVariables(): EnvVars {
    const {
      CANVA_FRONTEND_PORT,
      CANVA_APP_ID,
      CANVA_APP_ORIGIN,
      CANVA_HMR_ENABLED,
    } = this.env;

    if (!CANVA_FRONTEND_PORT) {
      throw new Error(
        "CANVA_FRONTEND_PORT environment variable is not defined",
      );
    }

    const envVars: EnvVars = {
      frontendPort: parseInt(CANVA_FRONTEND_PORT, 10),
      hmrEnabled: CANVA_HMR_ENABLED?.toLowerCase().trim() === "true",
      appId: CANVA_APP_ID,
      appOrigin: CANVA_APP_ORIGIN,
    };

    if (envVars.hmrEnabled && envVars.appOrigin == null) {
      throw new Error(
        "CANVA_HMR_ENABLED environment variable is TRUE, but CANVA_APP_ORIGIN is not set. Refer to the instructions in the README.md on configuring HMR.",
      );
    }

    return envVars;
  }
}
