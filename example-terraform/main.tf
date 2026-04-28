# ============================================================================
# 🚀 STAGE 1: FOUNDATION AND PROVIDER SETUP
# ============================================================================

terraform {
  required_version = ">= 1.5.0"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }

  backend "local" {
    path = "terraform.tfstate"
  }
}

provider "aws" {
  region = var.aws_region
}

# --- Data Fetching ---
# Fetch the availability zones for HA deployments
data "aws_availability_zones" "available" {
  state = "available"
}


# ============================================================================
# 🌐 STAGE 2: NETWORK INFRASTRUCTURE (VPC, SUBNETS, INTERCONNECTIVITY)
# ============================================================================

# 2.1 VPC Definition
resource "aws_vpc" "main" {
  cidr_block = var.vpc_cidr
  tags = {
    Name = "gemma-vpc"
  }
}

# 2.2 Subnets (HA Setup: 2 Public, 2 Private across AZs)
# Public Subnets (for Load Balancer and NAT)
resource "aws_subnet" "public" {
  count             = 2
  vpc_id            = aws_vpc.main.id
  cidr_block        = cidrsubnet(var.vpc_cidr, 8, count.index * 2)
  availability_zone = data.aws_availability_zones.available.names[count.index]
  tags              = { Name = "public-subnet-${count.index}" }
}

# Private Subnets (for Web Server and Database)
resource "aws_subnet" "private" {
  count             = 2
  vpc_id            = aws_vpc.main.id
  cidr_block        = cidrsubnet(var.vpc_cidr, 8, count.index + 2)
  availability_zone = data.aws_availability_zones.available.names[count.index]
  tags              = { Name = "private-subnet-${count.index}" }
}

# 2.3 Internet Gateway (IGW)
resource "aws_internet_gateway" "gw" {
  vpc_id = aws_vpc.main.id
  tags   = { Name = "gemma-igw" }
}

# 2.4 Route Tables & Association
# A. Public Route Table (Routes traffic to the IGW)
resource "aws_route_table" "public" {
  vpc_id = aws_vpc.main.id
  tags   = { Name = "public-rt" }
}
resource "aws_route" "public_internet" {
  route_table_id         = aws_route_table.public.id
  destination_cidr_block = "0.0.0.0/0"
  gateway_id             = aws_internet_gateway.gw.id
}
# Associate the public route table with the public subnets
resource "aws_route_table_association" "public_assoc" {
  count          = 2
  subnet_id      = aws_subnet.public[count.index].id
  route_table_id = aws_route_table.public.id
}

# B. NAT Gateway (Allows private instances to access the internet)
resource "aws_eip" "nat_ip" {
  count  = 2
  domain = "vpc"
}

resource "aws_nat_gateway" "nat" {
  count         = 2
  allocation_id = aws_eip.nat_ip[count.index].id
  subnet_id     = aws_subnet.public[count.index].id
  tags          = { Name = "gemma-nat-gw-${count.index}" }
  depends_on    = [aws_internet_gateway.gw]
}

# C. Private Route Table (Routes 0.0.0.0/0 traffic through the NAT Gateway)
resource "aws_route_table" "private" {
  vpc_id = aws_vpc.main.id
  tags   = { Name = "private-rt" }
}
resource "aws_route" "private_nat" {
  route_table_id         = aws_route_table.private.id
  destination_cidr_block = "0.0.0.0/0"
  nat_gateway_id         = aws_nat_gateway.nat[0].id # Use the first NAT for simplicity
}
# Associate the private route table with the private subnets
resource "aws_route_table_association" "private_assoc" {
  count          = 2
  subnet_id      = aws_subnet.private[count.index].id
  route_table_id = aws_route_table.private.id
}


# ============================================================================
# 🛡️ STAGE 3: SECURITY GROUPS (The Firewall Rules)
# ============================================================================

# 3.1 Common Security Group for All Application Services
resource "aws_security_group" "app_sg" {
  name   = "gemma-app-services"
  vpc_id = aws_vpc.main.id
}

# 3.2 Web Server Security Group (Allows incoming traffic from anywhere)
resource "aws_security_group" "web_sg" {
  name   = "web-server-sg"
  vpc_id = aws_vpc.main.id
  ingress {
    from_port   = 80
    to_port     = 80
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"] # Allow all internet traffic
  }
  ingress {
    from_port   = 443
    to_port     = 443
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }
  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }
}

# 3.3 Database Security Group (Restrict access ONLY to the Web SG)
resource "aws_security_group" "db_sg" {
  name   = "rds-db-sg"
  vpc_id = aws_vpc.main.id
  ingress {
    from_port       = 5432
    to_port         = 5432
    protocol        = "tcp"
    security_groups = [aws_security_group.web_sg.id] # ONLY the Web SG can talk to DB
  }
  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }
}

# 3.4 Load Balancer Security Group (Allows inbound 80/443 from anywhere)
resource "aws_security_group" "alb_sg" {
  name   = "alb-sg"
  vpc_id = aws_vpc.main.id
  ingress {
    from_port   = 80
    to_port     = 80
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }
  ingress {
    from_port   = 443
    to_port     = 443
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }
  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }
}


# ============================================================================
# 🔒 STAGE 4: CORE SERVICES (DB & SECRETS)
# ============================================================================

# 4.1 Secrets Management (CRITICAL FIX: Do not hardcode passwords)
resource "aws_secretsmanager_secret" "db_secret" {
  name        = "gemma/postgres/password"
  description = "Database connection password for the application."
}

# 4.2 RDS PostgreSQL Instance
resource "aws_db_instance" "postgres" {
  allocated_storage      = 20
  storage_type           = "gp2"
  engine                 = "postgres"
  engine_version         = "14.6"
  username               = "gemmauser"
  password               = var.db_root_password # Use this for creation only, then update secret
  instance_class         = "db.t3.micro"
  db_subnet_group_name   = aws_db_subnet_group.main.name # Must be in private subnet
  vpc_security_group_ids = [aws_security_group.db_sg.id]
  skip_final_snapshot    = true
  publicly_accessible    = false
  tags                   = { Name = "gemma-rds-postgres" }
  # This ensures the secret gets the actual password after initial setup
  lifecycle {
    ignore_changes = [password]
  }
}

# DB Subnet Group (Spreads RDS across private subnets)
resource "aws_db_subnet_group" "main" {
  name       = "gemma-db-subnet-group"
  subnet_ids = aws_subnet.private[*].id
}

# Update the secret with the final password (Optional cleanup step)
resource "aws_secretsmanager_secret_version" "db_secret_version" {
  secret_id     = aws_secretsmanager_secret.db_secret.id
  secret_string = var.db_root_password
}


# ============================================================================
# 🌐 STAGE 5: COMPUTING (WEB SERVER & LOAD BALANCING)
# ============================================================================

# 5.1 Application Load Balancer (Fronts the web server)
resource "aws_lb" "app_alb" {
  internal           = false
  load_balancer_type = "application"
  subnets            = aws_subnet.public[*].id
  security_groups    = [aws_security_group.alb_sg.id]
  tags               = { Name = "gemma-app-alb" }
}

# 5.2 Target Group (Defines where the ALB sends traffic)
resource "aws_lb_target_group" "web_tg" {
  name     = "web-server-tg"
  port     = 80
  protocol = "HTTP"
  vpc_id   = aws_vpc.main.id
}

# 5.3 Web Server EC2 Instance (The actual application host)
resource "aws_instance" "web_server" {
  # Using a simple AMI for demonstration purposes
  ami                    = "ami-0abcdef1234567890"
  instance_type          = "t3.micro"
  subnet_id              = aws_subnet.private[0].id # Place in the first private subnet
  vpc_security_group_ids = [aws_security_group.web_sg.id]
  key_name               = "your-ssh-key" # !!! CHANGE THIS !!!
  tags                   = { Name = "gemma-web-server" }
}

# 5.4 Attaching Target Group to the Web Server
resource "aws_lb_target_group_attachment" "attachment" {
  target_group_arn = aws_lb_target_group.web_tg.arn
  target_id        = aws_instance.web_server.id
  port             = 80
}

# 5.5 ALB Listener (HTTP Listener)
resource "aws_lb_listener" "http" {
  load_balancer_arn = aws_lb.app_alb.arn
  port              = "80"
  protocol          = "HTTP"
  default_action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.web_tg.arn
  }
}


# ============================================================================
# 🗄️ STAGE 6: CONTAINER ORCHESTRATION (EKS)
# ============================================================================

# 6.1 EKS Cluster (Control Plane)
resource "aws_eks_cluster" "main" {
  name     = "gemma-eks-cluster"
  role_arn = aws_iam_role.eks_master_role.arn
  vpc_config {
    subnet_ids              = aws_subnet.private[*].id
    endpoint_private_access = false
    endpoint_public_access  = true
  }
  version = "1.28"
  depends_on = [
    aws_iam_role_policy_attachment.eks_cluster_policy
  ]
}

# IAM Role for EKS Control Plane (Required)
resource "aws_iam_role" "eks_master_role" {
  name = "gemma-eks-master-role"
  assume_role_policy = jsonencode({
    Version = "2012-10-17",
    Statement = [{
      Action = "sts:AssumeRole"
      Effect = "Allow"
      Principal = {
        Service = "eks.amazonaws.com"
      }
    }]
  })
}

resource "aws_iam_role_policy_attachment" "eks_cluster_policy" {
  role       = aws_iam_role.eks_master_role.name
  policy_arn = "arn:aws:iam::aws:policy/AmazonEKSClusterPolicy"
}

resource "aws_iam_role" "eks_worker_role" {
  name = "gemma-eks-worker-role"
  assume_role_policy = jsonencode({
    Version = "2012-10-17",
    Statement = [{
      Action = "sts:AssumeRole"
      Effect = "Allow"
      Principal = {
        Service = "ec2.amazonaws.com"
      }
    }]
  })
}

resource "aws_iam_role_policy_attachment" "eks_worker_node_policy" {
  role       = aws_iam_role.eks_worker_role.name
  policy_arn = "arn:aws:iam::aws:policy/AmazonEKSWorkerNodePolicy"
}

resource "aws_iam_role_policy_attachment" "eks_worker_cni_policy" {
  role       = aws_iam_role.eks_worker_role.name
  policy_arn = "arn:aws:iam::aws:policy/AmazonEKS_CNI_Policy"
}

resource "aws_iam_role_policy_attachment" "eks_worker_ecr_policy" {
  role       = aws_iam_role.eks_worker_role.name
  policy_arn = "arn:aws:iam::aws:policy/AmazonEC2ContainerRegistryReadOnly"
}

# 6.2 EKS Worker Node Group (The actual compute capacity)
resource "aws_eks_node_group" "workers" {
  cluster_name    = aws_eks_cluster.main.name
  node_group_name = "gemma-workers"
  node_role_arn   = aws_iam_role.eks_worker_role.arn
  labels          = { role = "worker" }
  subnet_ids      = aws_subnet.private[*].id
  instance_types  = ["t3.medium"]
  scaling_config {
    desired_size = 2
    max_size     = 4
    min_size     = 2
  }
  depends_on = [
    aws_iam_role_policy_attachment.eks_worker_node_policy,
    aws_iam_role_policy_attachment.eks_worker_cni_policy,
    aws_iam_role_policy_attachment.eks_worker_ecr_policy
  ]
}


# ============================================================================
# 🏷️ STAGE 7: OUTPUTS (For easy access post-deployment)
# ============================================================================

output "vpc_id" {
  description = "The ID of the main VPC."
  value       = aws_vpc.main.id
}

output "alb_endpoint" {
  description = "The external DNS endpoint of the Application Load Balancer."
  value       = aws_lb.app_alb.dns_name
}

output "db_endpoint" {
  description = "The fully qualified domain name (DNS) for the RDS instance."
  value       = aws_db_instance.postgres.address
}

output "db_secret_arn" {
  description = "The ARN for the stored database secret."
  value       = aws_secretsmanager_secret.db_secret.arn
}
