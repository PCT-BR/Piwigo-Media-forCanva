#!/usr/bin/env node
/* eslint-disable no-console */
import yargs from "yargs";
import { AppRunner, errorChalk } from "./app_runner";
import { hideBin } from "yargs/helpers";
import { Context } from "./context";

const appRunner = new AppRunner();

yargs(hideBin(process.argv))
  .version(false)
  .help()
  .option("use-https", {
    description: "Start local development server on HTTPS.",
    type: "boolean",
    // npm swallows commands line args instead of forwarding to the script
    default:
      process.env.npm_config_use_https?.toLocaleLowerCase().trim() === "true",
  })
  .option("override-frontend-port", {
    description:
      "Port to run the local development server on. Overrides the frontend port set in the .env file.",
    type: "number",
    alias: "p",
  })
  .option("preview", {
    description: "Open the app in Canva.",
    type: "boolean",
    default: false,
  })
  .command(
    "$0",
    "Starts a local development server for the app in /src",
    () => {},
    async (args) => {
      const ctx = new Context(process.env, args);
      appRunner.run(ctx);
    },
  )
  .fail((message, error) => {
    if (error) {
      throw error;
    }

    console.log(errorChalk("Error:"), message);
    process.exit(1);
  })
  .parse();
