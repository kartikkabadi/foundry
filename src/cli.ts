#!/usr/bin/env node
import { dispatch } from './commands/dispatch.js';

dispatch(process.argv.slice(2));
