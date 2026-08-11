# Ledgerlight on AWS App Runner + RDS MySQL. Small, real, and Free-Tier-minded:
# App Runner runs the single container (API + SPA); a VPC connector lets it
# reach a private RDS MySQL instance; all secrets live in Secrets Manager and
# are injected as runtime env, never baked into the image.

data "aws_vpc" "default" {
  default = true
}

data "aws_subnets" "default" {
  filter {
    name   = "vpc-id"
    values = [data.aws_vpc.default.id]
  }
}

# ---------- generated secrets ----------
resource "random_password" "db" {
  length  = 24
  special = false
}

resource "random_password" "jwt" {
  length  = 48
  special = false
}

# ---------- image registry ----------
resource "aws_ecr_repository" "app" {
  name                 = var.app_name
  image_tag_mutability = "MUTABLE"
  image_scanning_configuration {
    scan_on_push = true
  }
}

# ---------- networking for private db access ----------
resource "aws_security_group" "apprunner" {
  name_prefix = "${var.app_name}-apprunner-"
  description = "App Runner VPC connector egress"
  vpc_id      = data.aws_vpc.default.id
  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }
  lifecycle {
    create_before_destroy = true
  }
}

resource "aws_security_group" "db" {
  name_prefix = "${var.app_name}-db-"
  description = "MySQL reachable only from the App Runner connector"
  vpc_id      = data.aws_vpc.default.id
  ingress {
    description     = "MySQL from App Runner only"
    from_port       = 3306
    to_port         = 3306
    protocol        = "tcp"
    security_groups = [aws_security_group.apprunner.id]
  }
  lifecycle {
    create_before_destroy = true
  }
}

resource "aws_db_subnet_group" "db" {
  name       = "${var.app_name}-db"
  subnet_ids = data.aws_subnets.default.ids
}

# ---------- database ----------
resource "aws_db_instance" "mysql" {
  identifier             = "${var.app_name}-mysql"
  engine                 = "mysql"
  engine_version         = "8.0"
  instance_class         = var.db_instance_class
  allocated_storage      = 20
  storage_type           = "gp3"
  storage_encrypted      = true
  db_name                = var.db_name
  username               = var.db_username
  password               = random_password.db.result
  db_subnet_group_name   = aws_db_subnet_group.db.name
  vpc_security_group_ids = [aws_security_group.db.id]
  publicly_accessible    = false
  multi_az               = false
  skip_final_snapshot    = true # demo; set false + backup_retention_period for prod
  backup_retention_period = 1
  deletion_protection    = false
  apply_immediately      = true
}

# ---------- secrets ----------
resource "aws_secretsmanager_secret" "app" {
  name_prefix = "${var.app_name}-app-"
}

resource "aws_secretsmanager_secret_version" "app" {
  secret_id = aws_secretsmanager_secret.app.id
  secret_string = jsonencode({
    DB_HOST        = aws_db_instance.mysql.address
    DB_PORT        = "3306"
    DB_USER        = var.db_username
    DB_PASSWORD    = random_password.db.result
    DB_NAME        = var.db_name
    JWT_SECRET     = random_password.jwt.result
    GEMINI_API_KEY = var.gemini_api_key
    GEMINI_MODEL   = var.gemini_model
  })
}

# ---------- iam ----------
data "aws_iam_policy_document" "apprunner_assume_build" {
  statement {
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["build.apprunner.amazonaws.com"]
    }
  }
}

data "aws_iam_policy_document" "apprunner_assume_tasks" {
  statement {
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["tasks.apprunner.amazonaws.com"]
    }
  }
}

# ECR pull role for App Runner.
resource "aws_iam_role" "apprunner_access" {
  name               = "${var.app_name}-apprunner-access"
  assume_role_policy = data.aws_iam_policy_document.apprunner_assume_build.json
}

resource "aws_iam_role_policy_attachment" "apprunner_ecr" {
  role       = aws_iam_role.apprunner_access.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSAppRunnerServicePolicyForECRAccess"
}

# Instance role: read exactly one secret, nothing else (least privilege).
resource "aws_iam_role" "apprunner_instance" {
  name               = "${var.app_name}-apprunner-instance"
  assume_role_policy = data.aws_iam_policy_document.apprunner_assume_tasks.json
}

data "aws_iam_policy_document" "read_secret" {
  statement {
    actions   = ["secretsmanager:GetSecretValue"]
    resources = [aws_secretsmanager_secret.app.arn]
  }
}

resource "aws_iam_role_policy" "apprunner_secret" {
  name   = "${var.app_name}-read-secret"
  role   = aws_iam_role.apprunner_instance.id
  policy = data.aws_iam_policy_document.read_secret.json
}

# ---------- app runner ----------
resource "aws_apprunner_vpc_connector" "db" {
  vpc_connector_name = "${var.app_name}-db"
  subnets            = data.aws_subnets.default.ids
  security_groups    = [aws_security_group.apprunner.id]
}

resource "aws_apprunner_service" "app" {
  service_name = var.app_name

  source_configuration {
    authentication_configuration {
      access_role_arn = aws_iam_role.apprunner_access.arn
    }
    image_repository {
      image_identifier      = var.container_image
      image_repository_type = "ECR"
      image_configuration {
        port = "8080"
        runtime_environment_secrets = {
          DB_HOST        = "${aws_secretsmanager_secret.app.arn}:DB_HOST::"
          DB_PORT        = "${aws_secretsmanager_secret.app.arn}:DB_PORT::"
          DB_USER        = "${aws_secretsmanager_secret.app.arn}:DB_USER::"
          DB_PASSWORD    = "${aws_secretsmanager_secret.app.arn}:DB_PASSWORD::"
          DB_NAME        = "${aws_secretsmanager_secret.app.arn}:DB_NAME::"
          JWT_SECRET     = "${aws_secretsmanager_secret.app.arn}:JWT_SECRET::"
          GEMINI_API_KEY = "${aws_secretsmanager_secret.app.arn}:GEMINI_API_KEY::"
          GEMINI_MODEL   = "${aws_secretsmanager_secret.app.arn}:GEMINI_MODEL::"
        }
      }
    }
    auto_deployments_enabled = false
  }

  instance_configuration {
    cpu               = "1024"
    memory            = "2048"
    instance_role_arn = aws_iam_role.apprunner_instance.arn
  }

  network_configuration {
    egress_configuration {
      egress_type       = "VPC"
      vpc_connector_arn = aws_apprunner_vpc_connector.db.arn
    }
  }

  health_check_configuration {
    protocol = "HTTP"
    path     = "/api/rules"
  }

  depends_on = [aws_iam_role_policy.apprunner_secret]
}
