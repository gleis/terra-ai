// Very rough monthly USD estimates for common AWS resource types, assuming
// small/default instance sizes and us-east-1. These are ballpark figures for
// architecture review only — NOT a substitute for real pricing or Infracost.
const ROUGH_MONTHLY_USD: Record<string, number> = {
  aws_instance: 30,
  aws_db_instance: 50,
  aws_rds_cluster: 100,
  aws_rds_cluster_instance: 60,
  aws_nat_gateway: 33,
  aws_lb: 23,
  aws_alb: 23,
  aws_elb: 18,
  aws_eks_cluster: 73,
  aws_eks_node_group: 60,
  aws_ecs_service: 15,
  aws_elasticache_cluster: 25,
  aws_elasticache_replication_group: 50,
  aws_redshift_cluster: 180,
  aws_opensearch_domain: 80,
  aws_elasticsearch_domain: 80,
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
  aws_ebs_volume: 8,
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
  aws_fsx_lustre_file_system: 100
}

// Extract the resource type from a node label like "aws_instance.web" or
// "module.x.aws_db_instance.main". Returns null for modules/data/vars.
export function resourceTypeFromLabel(label: string): string | null {
  const parts = label.split('.')
  const typeIdx = parts.findIndex((p) => p.startsWith('aws_'))
  if (typeIdx === -1) return null
  return parts[typeIdx]
}

export function estimateMonthlyCost(label: string): number | null {
  const type = resourceTypeFromLabel(label)
  if (!type) return null
  return ROUGH_MONTHLY_USD[type] ?? null
}
