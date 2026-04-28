variable "aws_region" {
  description = "AWS region used by the example infrastructure."
  type        = string
  default     = "us-west-2"
}

variable "vpc_cidr" {
  description = "CIDR block for the example VPC."
  type        = string
  default     = "10.0.0.0/16"
}

variable "db_root_password" {
  description = "Demo database password for the example RDS instance."
  type        = string
  default     = "ChangeMe123!"
  sensitive   = true
}
