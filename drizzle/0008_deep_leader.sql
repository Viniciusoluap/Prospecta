CREATE TABLE `user_notifications` (
	`id` int AUTO_INCREMENT NOT NULL,
	`user_id` int NOT NULL,
	`title` varchar(255) NOT NULL,
	`message` text NOT NULL,
	`type` enum('draw_result','utef_update','construction_update','system','promotional') NOT NULL,
	`is_read` int NOT NULL DEFAULT 0,
	`related_id` int,
	`action_url` varchar(500),
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`read_at` timestamp,
	CONSTRAINT `user_notifications_id` PRIMARY KEY(`id`)
);
