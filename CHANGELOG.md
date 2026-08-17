# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## Unreleased

### Added

- Experimental one-shot run mode ([#1](https://github.com/kartikkabadi/foundry/issues/1)): continues the Walk past gates by auto-answering Grill Decision tickets with the worker recommendation and auto-resolving the other gates; the operator can pause, cancel back to HITL, or override at any point. One-shot stops before the merge stage — Foundry does not open or merge a GitHub pull request in this mode.
