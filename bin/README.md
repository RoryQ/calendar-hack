# Plan Management Tools

This directory contains scripts for managing training plans in the `public/plans/yaml` directory.

## Scripts

### `convertPlans`
Converts all YAML plans in `public/plans/yaml` to JSON format in `public/plans/json`.
```bash
bin/convertPlans
```

### `validatePlans`
Validates all YAML plans against `public/schema/plan-schema.json`.
```bash
bin/validatePlans
```
To validate a specific file:
```bash
node bin/validatePlans.js public/plans/yaml/my_plan.yaml
```

### `structurePlan.js`
Automates the creation of structured workout steps for Pfitzinger-style plans. It parses workout titles (e.g., "LT with 20 minutes at LT pace") and generates the corresponding `steps` array required for FIT file generation.

**Usage:**
```bash
node bin/structurePlan.js public/plans/yaml/pfitz_plan.yaml
```
This will generate `public/plans/yaml/pfitz_plan_structured.yaml`.

## Environment Requirements
These scripts require [Node.js](https://nodejs.org/) and the following packages:
- `js-yaml`
- `ajv`

Ensure they are installed via `npm install` (or `yarn`) before running.
