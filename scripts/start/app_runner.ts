/* eslint-disable no-console */
import type { Context } from "./context";
import chalk from "chalk";
import { buildConfig } from "../../webpack.config";
import Table from "cli-table3";
import webpack from "webpack";
import WebpackDevServer from "webpack-dev-server";
import open from "open";
import { generatePreviewUrl } from "@canva/cli";
import type { Certificate } from "../ssl/ssl";
import { createOrRetrieveCertificate } from "../ssl/ssl";
import os from "os";

export const infoChalk = chalk.blue.bold;
export const warnChalk = chalk.bgYellow.bold;
export const errorChalk = chalk.bgRed.bold;
export const highlightChalk = chalk.greenBright.bold;
export const linkChalk = chalk.cyan;

/**
 * Returns the appropriate modifier key text based on the user's operating system.
 * @returns "cmd" for macOS, "ctrl" for Windows and Linux
 */
export function getModifierKey(): string {
  const platform = os.platform();
  switch (platform) {
    case "darwin": // macOS
      return "cmd";
    case "win32": // Windows
      return "ctrl";
    default: // Linux and others
      return "ctrl";
  }
}

export class AppRunner {
  async run(ctx: Context) {
    console.log(
      infoChalk("Info:"),
      `Starting development server for ${highlightChalk(ctx.entryDir)}\n`,
    );

    if (!ctx.hmrEnabled) {
      console.log(
        `${infoChalk(
          "Note:",
        )} Hot Module Replacement (HMR) not enabled. To enable it, please refer to the instructions in the ${highlightChalk(
          "README.md",
        )}\n`,
      );
    }

    let cert: Certificate | undefined;
    if (ctx.httpsEnabled) {
      try {
        cert = await createOrRetrieveCertificate();
      } catch (err) {
        console.log(
          errorChalk("Error:"),
          "Unable to generate SSL certificate.",
        );
        throw err;
      }
    }

    const table = new Table({
      colWidths: [30, 80],
      wordWrap: true,
      wrapOnWordBoundary: true,
    });

    await this.runWebpackDevServer(ctx, table, cert);

    await this.generateAndOpenPreviewUrl(ctx.openPreview, table);

    console.log(table.toString(), "\n");

    console.log(
      `${infoChalk(
        "Note:",
      )} For instructions on how to set up the app via the Developer Portal, see the ${highlightChalk(
        "README.md",
      )}.\n`,
    );
  }

  private readonly runWebpackDevServer = async (
    ctx: Context,
    table: Table.Table,
    cert: Certificate | undefined,
  ): Promise<WebpackDevServer> => {
    const runtimeWebpackConfig = buildConfig({
      appEntry: ctx.frontendEntryPath,
      devConfig: {
        port: ctx.frontendPort,
        enableHmr: ctx.hmrEnabled,
        appId: ctx.appId,
        appOrigin: ctx.appOrigin,
        enableHttps: ctx.httpsEnabled,
        ...cert,
      },
    });

    const compiler = webpack(runtimeWebpackConfig);
    const server = new WebpackDevServer(
      runtimeWebpackConfig.devServer,
      compiler,
    );
    await server.start();

    table.push(["Development URL (Frontend)", linkChalk(ctx.frontendUrl)]);

    return server;
  };

  /**
   * Calls the Canva CLI to generate a preview URL for the app
   */
  private readonly generateAndOpenPreviewUrl = async (
    openPreview: boolean,
    table: Table.Table,
  ) => {
    const previewCellHeader = { content: "Preview your app in Canva" };

    const generatePreviewResult = await generatePreviewUrl();

    if (!generatePreviewResult.success) {
      table.push([
        previewCellHeader,
        { content: warnChalk(generatePreviewResult.message) },
      ]);
      return;
    }

    const modifierKey = getModifierKey();

    table.push([
      previewCellHeader,
      {
        content: `Preview URL (${modifierKey} + click)`,
        href: generatePreviewResult.data,
      },
    ]);

    if (openPreview) {
      open(generatePreviewResult.data);
    }
  };
}
