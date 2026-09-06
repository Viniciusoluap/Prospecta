CREATE TABLE `email_logs` (
	`id` int AUTO_INCREMENT NOT NULL,
	`recipient_email` varchar(320) NOT NULL,
	`recipient_name` varchar(255),
	`subject` varchar(500) NOT NULL,
	`template_type` enum('welcome','budget_confirmation','budget_update','draw_winner','promotional_campaign') NOT NULL,
	`html_content` text NOT NULL,
	`status` enum('pending','sent','failed') NOT NULL DEFAULT 'pending',
	`sent_at` timestamp,
	`error_message` text,
	`metadata` text,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `email_logs_id` PRIMARY KEY(`id`)
);
