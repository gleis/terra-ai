// Best-practice Terraform workspace scaffolding.
//
// Generates a deterministic, provider-aware skeleton: version pinning,
// provider config, a partial (per-environment) remote backend, common
// variables/tags, and a `.gitignore` — everything a new production
// Terraform root module needs before any resources are added. Resources
// themselves are intentionally left for the AI/manual workflow; this
// module only writes the scaffolding that should never be hand-authored
// twice.

export type ScaffoldProvider = 'aws' | 'gcp' | 'azure'

export interface ScaffoldOptions {
  projectName: string
  provider: ScaffoldProvider
  environments: string[]
}

export interface ScaffoldFile {
  path: string
  content: string
}

function slugify(name: string): string {
  const slug = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return slug || 'my-project'
}

function providerBlock(provider: ScaffoldProvider): string {
  switch (provider) {
    case 'aws':
      return `terraform {
  required_version = ">= 1.7.0"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }
}
`
    case 'gcp':
      return `terraform {
  required_version = ">= 1.7.0"

  required_providers {
    google = {
      source  = "hashicorp/google"
      version = "~> 5.0"
    }
  }
}
`
    case 'azure':
      return `terraform {
  required_version = ">= 1.7.0"

  required_providers {
    azurerm = {
      source  = "hashicorp/azurerm"
      version = "~> 3.90"
    }
  }
}
`
  }
}

function providersFile(provider: ScaffoldProvider): string {
  switch (provider) {
    case 'aws':
      return `provider "aws" {
  region = var.aws_region

  default_tags {
    tags = local.common_tags
  }
}
`
    case 'gcp':
      return `provider "google" {
  project = var.project_id
  region  = var.region
}
`
    case 'azure':
      return `provider "azurerm" {
  features {}

  subscription_id = var.subscription_id
}
`
  }
}

function variablesFile(provider: ScaffoldProvider): string {
  const common = `variable "project_name" {
  description = "Short name used to prefix and tag every resource in this workspace."
  type        = string
}

variable "environment" {
  description = "Deployment environment for this workspace."
  type        = string

  validation {
    condition     = contains(["dev", "staging", "prod"], var.environment)
    error_message = "environment must be one of: dev, staging, prod."
  }
}

variable "extra_tags" {
  description = "Additional tags/labels merged into every resource on top of the common set."
  type        = map(string)
  default     = {}
}
`

  switch (provider) {
    case 'aws':
      return `${common}
variable "aws_region" {
  description = "AWS region this workspace deploys into."
  type        = string
  default     = "us-east-1"
}
`
    case 'gcp':
      return `${common}
variable "project_id" {
  description = "GCP project ID this workspace deploys into."
  type        = string
}

variable "region" {
  description = "GCP region this workspace deploys into."
  type        = string
  default     = "us-central1"
}
`
    case 'azure':
      return `${common}
variable "subscription_id" {
  description = "Azure subscription ID this workspace deploys into."
  type        = string
}

variable "location" {
  description = "Azure region this workspace deploys into."
  type        = string
  default     = "eastus"
}
`
  }
}

function localsFile(provider: ScaffoldProvider): string {
  const tagKey = provider === 'gcp' ? 'labels' : 'tags'
  return `locals {
  common_${tagKey} = merge(
    {
      Project     = var.project_name
      Environment = var.environment
      ManagedBy   = "terraform"
    },
    var.extra_tags
  )
}
`
}

function backendHcl(provider: ScaffoldProvider, projectSlug: string, env: string): string {
  switch (provider) {
    case 'aws':
      return `# Partial backend config for the "${env}" environment.
# Create the bucket and lock table once (e.g. via a separate bootstrap
# workspace), then initialize this root module with:
#   terraform init -backend-config=environments/${env}/backend.hcl
#
# bucket         = "${projectSlug}-tfstate"
# key            = "${env}/terraform.tfstate"
# region         = "us-east-1"
# dynamodb_table = "${projectSlug}-tf-lock"
# encrypt        = true
`
    case 'gcp':
      return `# Partial backend config for the "${env}" environment.
# Create the GCS bucket once, then initialize this root module with:
#   terraform init -backend-config=environments/${env}/backend.hcl
#
# bucket = "${projectSlug}-tfstate"
# prefix = "${env}"
`
    case 'azure':
      return `# Partial backend config for the "${env}" environment.
# Create the storage account and container once, then initialize this
# root module with:
#   terraform init -backend-config=environments/${env}/backend.hcl
#
# resource_group_name  = "${projectSlug}-tfstate-rg"
# storage_account_name = "${projectSlug.replace(/-/g, '')}tfstate"
# container_name       = "tfstate"
# key                  = "${env}.terraform.tfstate"
`
  }
}

function backendStub(provider: ScaffoldProvider): string {
  const type = provider === 'aws' ? 's3' : provider === 'gcp' ? 'gcs' : 'azurerm'
  return `# Backend type is fixed here; the connection details come from a
# per-environment partial config passed at init time — see
# environments/<env>/backend.hcl and the README.
terraform {
  backend "${type}" {}
}
`
}

function envTfvars(provider: ScaffoldProvider, env: string): string {
  const regionLine =
    provider === 'aws'
      ? 'aws_region   = "us-east-1"'
      : provider === 'gcp'
        ? 'region       = "us-central1"'
        : 'location     = "eastus"'
  return `environment  = "${env}"
${regionLine}
`
}

function gitignore(): string {
  return `# Local .terraform directories
**/.terraform/*

# Terraform state files — never commit real state
*.tfstate
*.tfstate.*

# Crash log files
crash.log
crash.*.log

# Files that may contain sensitive values
*.tfvars.json
override.tf
override.tf.json
*_override.tf
*_override.tf.json

# CLI config
.terraformrc
terraform.rc

# Do NOT ignore .terraform.lock.hcl — commit it for reproducible provider installs
`
}

function readme(options: ScaffoldOptions, projectSlug: string): string {
  const envList = options.environments.join(', ')
  return `# ${options.projectName}

Production Terraform root module scaffolded by Terra-AI. This is intentionally
just the skeleton: version pinning, provider configuration, a remote backend,
and common variables/tags. No resources are defined yet — use the AI Insights
sidebar in Terra-AI (or write HCL directly) to add them.

## Structure

\`\`\`text
versions.tf                  Terraform + provider version constraints
providers.tf                 Provider configuration (uses local.common_tags)
backend.tf                   Backend type only — connection details are per-environment
variables.tf                 Shared input variables
locals.tf                    Common tags/labels merged into every resource
outputs.tf                   Root module outputs (empty until resources exist)
.gitignore                   Excludes state and local .terraform/ directories
environments/
${options.environments.map((env) => `  ${env}/backend.hcl          Partial backend config for ${env}\n  ${env}/terraform.tfvars     Variable values for ${env}`).join('\n')}
\`\`\`

## Environments

This workspace targets: ${envList}.

Each environment has its own state file and backend config, driven by a single
shared root module — a standard production pattern that avoids duplicating
resource definitions per environment.

## Usage

\`\`\`bash
# Initialize against one environment's backend
terraform init -backend-config=environments/dev/backend.hcl

# Plan / apply using that environment's variables
terraform plan  -var-file=environments/dev/terraform.tfvars
terraform apply -var-file=environments/dev/terraform.tfvars
\`\`\`

Before the first \`init\`, create the backend resources referenced in each
\`environments/<env>/backend.hcl\` (state bucket/storage account and lock
table, if applicable) — commented inline in those files.

## Adding resources

Add new \`.tf\` files (e.g. \`network.tf\`, \`compute.tf\`, \`data.tf\`) alongside
these — this scaffold does not use a \`main.tf\` convention so resources can be
organized by concern from the start. Tag/label every resource with
\`local.common_tags\`${options.provider === 'gcp' ? ' (or `local.common_labels`)' : ''} for
consistent cost and ownership tracking.

---
Scaffolded for **${projectSlug}** (${options.provider.toUpperCase()}) by Terra-AI.
`
}

export function buildScaffoldFiles(options: ScaffoldOptions): ScaffoldFile[] {
  const projectSlug = slugify(options.projectName)
  const environments = options.environments.length > 0 ? options.environments : ['dev']

  const files: ScaffoldFile[] = [
    { path: 'versions.tf', content: providerBlock(options.provider) },
    { path: 'providers.tf', content: providersFile(options.provider) },
    { path: 'backend.tf', content: backendStub(options.provider) },
    { path: 'variables.tf', content: variablesFile(options.provider) },
    { path: 'locals.tf', content: localsFile(options.provider) },
    { path: 'outputs.tf', content: '# Add root module outputs here as resources are defined.\n' },
    { path: '.gitignore', content: gitignore() },
    { path: 'README.md', content: readme(options, projectSlug) }
  ]

  for (const env of environments) {
    files.push({
      path: `environments/${env}/backend.hcl`,
      content: backendHcl(options.provider, projectSlug, env)
    })
    files.push({
      path: `environments/${env}/terraform.tfvars`,
      content: envTfvars(options.provider, env)
    })
  }

  return files
}
