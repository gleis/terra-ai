// Rough monthly cost estimation for common AWS resources.
//
// These are approximations of us-east-1 on-demand Linux pricing, intended for
// relative comparison and architecture review — NOT billing accuracy. Use
// Infracost or the AWS calculator for real numbers.
//
// Pricing model: instance cost is (family hourly rate for a ".large") x (size
// multiplier) x HOURS_PER_MONTH, which tracks AWS's roughly-linear scaling
// within a family well enough for review purposes.

const HOURS_PER_MONTH = 730

// Hourly on-demand rate for the ".large" size of each family (us-east-1, Linux)
const FAMILY_LARGE_HOURLY: Record<string, number> = {
  t2: 0.0464,
  t3: 0.0832,
  t3a: 0.0752,
  t4g: 0.0672,
  m4: 0.1,
  m5: 0.096,
  m5a: 0.086,
  m5n: 0.119,
  m6a: 0.0864,
  m6i: 0.096,
  m6g: 0.077,
  m7i: 0.1008,
  m7g: 0.0816,
  c4: 0.1,
  c5: 0.085,
  c5a: 0.077,
  c5n: 0.108,
  c6a: 0.0765,
  c6i: 0.085,
  c6g: 0.068,
  c7i: 0.08925,
  c7g: 0.0725,
  r4: 0.133,
  r5: 0.126,
  r5a: 0.113,
  r5n: 0.149,
  r6a: 0.1134,
  r6i: 0.126,
  r6g: 0.1008,
  r7i: 0.1323,
  r7g: 0.10714,
  i3: 0.156,
  i4i: 0.172,
  x1e: 0.834,
  z1d: 0.186,
  g4dn: 0.263,
  g5: 0.5044,
  p3: 1.53,
  inf1: 0.114
}

const DEFAULT_FAMILY_LARGE_HOURLY = 0.1

// Size multipliers relative to ".large"
const SIZE_MULTIPLIERS: Record<string, number> = {
  nano: 0.0625,
  micro: 0.125,
  small: 0.25,
  medium: 0.5,
  large: 1,
  xlarge: 2,
  '2xlarge': 4,
  '3xlarge': 6,
  '4xlarge': 8,
  '6xlarge': 12,
  '8xlarge': 16,
  '9xlarge': 18,
  '10xlarge': 20,
  '12xlarge': 24,
  '16xlarge': 32,
  '18xlarge': 36,
  '24xlarge': 48,
  '32xlarge': 64,
  metal: 32
}

// RDS/ElastiCache managed instances cost more than the equivalent EC2 instance
const RDS_PREMIUM = 1.8
const ELASTICACHE_PREMIUM = 1.55
const REDSHIFT_NODE_MONTHLY = 180

// Storage, $/GB-month
const EBS_GP_PER_GB = 0.08
const EBS_IO_PER_GB = 0.125
const RDS_STORAGE_PER_GB = 0.115

// Flat monthly costs for resources with no meaningful size attribute
const FLAT_MONTHLY: Record<string, number> = {
  aws_nat_gateway: 33,
  aws_lb: 23,
  aws_alb: 23,
  aws_elb: 18,
  aws_eks_cluster: 73,
  aws_cloudfront_distribution: 5,
  aws_s3_bucket: 1,
  aws_dynamodb_table: 2,
  aws_sqs_queue: 0,
  aws_sns_topic: 0,
  aws_lambda_function: 1,
  aws_kinesis_stream: 11,
  aws_msk_cluster: 150,
  aws_mq_broker: 20,
  aws_efs_file_system: 5,
  aws_eip: 4,
  aws_vpn_connection: 36,
  aws_dx_connection: 220,
  aws_route53_zone: 1,
  aws_api_gateway_rest_api: 4,
  aws_apigatewayv2_api: 3,
  aws_secretsmanager_secret: 1,
  aws_kms_key: 1,
  aws_cloudwatch_log_group: 1,
  aws_sagemaker_endpoint: 90,
  aws_transfer_server: 216,
  aws_globalaccelerator_accelerator: 18,
  aws_fsx_lustre_file_system: 100,
  aws_opensearch_domain: 80,
  aws_elasticsearch_domain: 80
}

export type CostEstimate = {
  monthly: number
  // Human-readable explanation of what drove the number
  basis: string
  // True when sizing attributes could not be resolved (variables, interpolation)
  approximate: boolean
}

export type ResourceAttributes = Record<string, string>

// Extract the resource type from a node label like "aws_instance.web" or
// "module.x.aws_db_instance.main". Returns null for modules/vars.
export function resourceTypeFromLabel(label: string): string | null {
  const parts = label.split('.')
  const typeIdx = parts.findIndex((p) => p.startsWith('aws_'))
  if (typeIdx === -1) return null
  return parts[typeIdx]
}

// Parse an instance type like "m5.4xlarge" or "db.r6g.xlarge" into an hourly rate
function instanceHourly(instanceType: string): { hourly: number; known: boolean } {
  const cleaned = instanceType.replace(/^db\./, '').replace(/^cache\./, '')
  const [family, size] = cleaned.split('.')
  if (!family || !size) return { hourly: DEFAULT_FAMILY_LARGE_HOURLY, known: false }

  const familyRate = FAMILY_LARGE_HOURLY[family]
  const multiplier = SIZE_MULTIPLIERS[size]

  return {
    hourly: (familyRate ?? DEFAULT_FAMILY_LARGE_HOURLY) * (multiplier ?? 1),
    known: familyRate !== undefined && multiplier !== undefined
  }
}

// A value is usable only if it is a plain literal, not a variable reference
function literalNumber(value: string | undefined): number | null {
  if (value === undefined) return null
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

function isLiteral(value: string | undefined): value is string {
  if (!value) return false
  return !/[${}]|^var\.|^local\.|^data\./.test(value)
}

export function estimateResourceCost(
  label: string,
  attributes: ResourceAttributes = {}
): CostEstimate | null {
  const type = resourceTypeFromLabel(label)
  if (!type) return null

  const countValue = literalNumber(attributes.count) ?? literalNumber(attributes.desired_count) ?? null
  const count = countValue !== null && countValue > 0 ? countValue : 1
  const countNote = count > 1 ? ` x${count}` : ''
  const unresolvedCount = attributes.count !== undefined && countValue === null

  const finish = (monthly: number, basis: string, approximate: boolean): CostEstimate => ({
    monthly: Math.round(monthly * count),
    basis: `${basis}${countNote}`,
    approximate: approximate || unresolvedCount
  })

  // EC2 and other instance-sized compute
  if (type === 'aws_instance' || type === 'aws_spot_instance_request') {
    const instanceType = attributes.instance_type
    if (!isLiteral(instanceType)) {
      return finish(
        DEFAULT_FAMILY_LARGE_HOURLY * HOURS_PER_MONTH,
        'unknown instance type — assumed .large',
        true
      )
    }
    const { hourly, known } = instanceHourly(instanceType)
    const spotDiscount = type === 'aws_spot_instance_request' ? 0.35 : 1
    const volume = literalNumber(attributes.volume_size)
    const storage = volume ? volume * EBS_GP_PER_GB : 0
    const basis = `${instanceType}${volume ? ` + ${volume}GB EBS` : ''}${known ? '' : ' (family not in table)'}`
    return finish(hourly * HOURS_PER_MONTH * spotDiscount + storage, basis, !known)
  }

  // RDS
  if (type === 'aws_db_instance' || type === 'aws_rds_cluster_instance') {
    const instanceClass = attributes.instance_class
    const storage = literalNumber(attributes.allocated_storage)
    const multiAz = attributes.multi_az === 'true' ? 2 : 1
    if (!isLiteral(instanceClass)) {
      return finish(
        DEFAULT_FAMILY_LARGE_HOURLY * RDS_PREMIUM * HOURS_PER_MONTH * multiAz,
        'unknown instance class — assumed db.large',
        true
      )
    }
    const { hourly, known } = instanceHourly(instanceClass)
    const compute = hourly * RDS_PREMIUM * HOURS_PER_MONTH * multiAz
    const storageCost = storage ? storage * RDS_STORAGE_PER_GB * multiAz : 0
    const basis = `${instanceClass}${storage ? ` + ${storage}GB` : ''}${multiAz > 1 ? ', multi-AZ' : ''}`
    return finish(compute + storageCost, basis, !known)
  }

  // ElastiCache
  if (type === 'aws_elasticache_cluster' || type === 'aws_elasticache_replication_group') {
    const nodeType = attributes.node_type
    const nodes =
      literalNumber(attributes.num_cache_nodes) ??
      literalNumber(attributes.replica_count) ??
      literalNumber(attributes.num_node_groups) ??
      1
    if (!isLiteral(nodeType)) {
      return finish(
        DEFAULT_FAMILY_LARGE_HOURLY * ELASTICACHE_PREMIUM * HOURS_PER_MONTH * nodes,
        'unknown node type — assumed cache.large',
        true
      )
    }
    const { hourly, known } = instanceHourly(nodeType)
    const basis = `${nodeType}${nodes > 1 ? ` x${nodes} nodes` : ''}`
    return finish(hourly * ELASTICACHE_PREMIUM * HOURS_PER_MONTH * nodes, basis, !known)
  }

  // Redshift
  if (type === 'aws_redshift_cluster') {
    const nodes = literalNumber(attributes.number_of_nodes) ?? 1
    return finish(REDSHIFT_NODE_MONTHLY * nodes, `${nodes} node${nodes > 1 ? 's' : ''}`, false)
  }

  // Standalone EBS volumes
  if (type === 'aws_ebs_volume') {
    const size = literalNumber(attributes.size)
    const perGb = attributes.storage_type === 'io1' || attributes.storage_type === 'io2' ? EBS_IO_PER_GB : EBS_GP_PER_GB
    if (size === null) return finish(8, 'unknown volume size — assumed 100GB', true)
    return finish(size * perGb, `${size}GB`, false)
  }

  // Autoscaling groups and node groups scale by desired capacity
  if (type === 'aws_autoscaling_group' || type === 'aws_eks_node_group') {
    const capacity =
      literalNumber(attributes.desired_capacity) ??
      literalNumber(attributes.desired_size) ??
      literalNumber(attributes.min_size) ??
      1
    const instanceType = attributes.instance_type
    if (!isLiteral(instanceType)) {
      return finish(
        DEFAULT_FAMILY_LARGE_HOURLY * HOURS_PER_MONTH * capacity,
        `${capacity} node${capacity > 1 ? 's' : ''}, unknown type`,
        true
      )
    }
    const { hourly, known } = instanceHourly(instanceType)
    return finish(
      hourly * HOURS_PER_MONTH * capacity,
      `${capacity}x ${instanceType}`,
      !known
    )
  }

  // ECS services scale by desired count (already applied via `count` handling)
  if (type === 'aws_ecs_service') {
    return finish(15, 'Fargate task baseline', true)
  }

  const flat = FLAT_MONTHLY[type]
  if (flat !== undefined) {
    return finish(flat, 'flat estimate for type', false)
  }

  return null
}

// Convenience wrapper for callers that only need the number
export function estimateMonthlyCost(label: string, attributes: ResourceAttributes = {}): number | null {
  return estimateResourceCost(label, attributes)?.monthly ?? null
}
