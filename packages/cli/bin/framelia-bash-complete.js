#!/usr/bin/env node
// Bash runs this on <TAB> after `framelia completion install`; it never loads a project .env.
import { runBashComplete } from "../dist/bash-complete.js";

await runBashComplete();
