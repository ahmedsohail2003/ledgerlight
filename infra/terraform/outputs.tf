output "service_url" {
  description = "Public HTTPS URL of the running app."
  value       = "https://${aws_apprunner_service.app.service_url}"
}

output "ecr_repository_url" {
  description = "Push the image here before apply."
  value       = aws_ecr_repository.app.repository_url
}

output "db_endpoint" {
  description = "Private RDS endpoint (reachable only from the app)."
  value       = aws_db_instance.mysql.address
}
