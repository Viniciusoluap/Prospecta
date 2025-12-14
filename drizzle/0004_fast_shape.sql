CREATE TABLE `construction_photos` (
	`id` int AUTO_INCREMENT NOT NULL,
	`project_id` int NOT NULL,
	`stage_id` int,
	`image_url` text NOT NULL,
	`caption` text,
	`taken_at` timestamp NOT NULL,
	`uploaded_by` int,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `construction_photos_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `construction_projects` (
	`id` int AUTO_INCREMENT NOT NULL,
	`user_id` int NOT NULL,
	`title` varchar(255) NOT NULL,
	`address` text,
	`project_type` varchar(100),
	`total_area` int,
	`estimated_cost` int,
	`actual_cost` int DEFAULT 0,
	`start_date` timestamp,
	`estimated_end_date` timestamp,
	`actual_end_date` timestamp,
	`status` enum('planning','in_progress','paused','completed','cancelled') NOT NULL DEFAULT 'planning',
	`progress` int NOT NULL DEFAULT 0,
	`notes` text,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `construction_projects_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `construction_stages` (
	`id` int AUTO_INCREMENT NOT NULL,
	`project_id` int NOT NULL,
	`name` varchar(255) NOT NULL,
	`description` text,
	`order_index` int NOT NULL,
	`status` enum('pending','in_progress','completed') NOT NULL DEFAULT 'pending',
	`start_date` timestamp,
	`end_date` timestamp,
	`estimated_cost` int,
	`actual_cost` int,
	`notes` text,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `construction_stages_id` PRIMARY KEY(`id`)
);
