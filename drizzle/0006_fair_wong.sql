CREATE TABLE `project_budget_requests` (
	`id` int AUTO_INCREMENT NOT NULL,
	`user_id` int,
	`name` varchar(255) NOT NULL,
	`email` varchar(320) NOT NULL,
	`phone` varchar(20),
	`city` varchar(255),
	`project_type` varchar(100),
	`has_lot` enum('yes','no','not_sure'),
	`message` text,
	`status` enum('pending','contacted','in_negotiation','converted','cancelled') NOT NULL DEFAULT 'pending',
	`admin_notes` text,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `project_budget_requests_id` PRIMARY KEY(`id`)
);
