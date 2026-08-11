variable "region" {
  description = "AWS region to deploy into."
  type        = string
  default     = "ca-central-1" # Canadian data residency, fitting the domain
}

variable "app_name" {
  type    = string
  default = "ledgerlight"
}

variable "container_image" {
  description = "ECR image URI (e.g. <acct>.dkr.ecr.<region>.amazonaws.com/ledgerlight:latest). Pushed by deploy.sh before apply."
  type        = string
}

variable "db_name" {
  type    = string
  default = "ledgerlight"
}

variable "db_username" {
  type    = string
  default = "ledgerlight"
}

variable "db_instance_class" {
  description = "RDS instance class. db.t4g.micro is Free-Tier-eligible for the first 12 months."
  type        = string
  default     = "db.t4g.micro"
}

variable "gemini_api_key" {
  description = "Gemini API key for the investigator agent. Provide via TF_VAR_gemini_api_key; never commit."
  type        = string
  sensitive   = true
}

variable "gemini_model" {
  type    = string
  default = "gemini-2.5-flash"
}
