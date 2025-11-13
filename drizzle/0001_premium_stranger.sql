CREATE TABLE `draws` (
	`id` int AUTO_INCREMENT NOT NULL,
	`title` varchar(255) NOT NULL,
	`description` text,
	`prize_amount` int NOT NULL,
	`ticket_price` int NOT NULL,
	`target_amount` int NOT NULL,
	`current_amount` int NOT NULL DEFAULT 0,
	`tickets_sold` int NOT NULL DEFAULT 0,
	`status` enum('active','closed','drawn') NOT NULL DEFAULT 'active',
	`draw_date` timestamp,
	`winner_user_id` int,
	`lottery_result` varchar(10),
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `draws_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `product_conversions` (
	`id` int AUTO_INCREMENT NOT NULL,
	`user_id` int NOT NULL,
	`product_id` int NOT NULL,
	`utef_amount` int NOT NULL,
	`status` enum('pending','completed','cancelled') NOT NULL DEFAULT 'pending',
	`notes` text,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `product_conversions_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `products` (
	`id` int AUTO_INCREMENT NOT NULL,
	`category` enum('real_estate','financial','nautical') NOT NULL,
	`title` varchar(255) NOT NULL,
	`description` text,
	`price_utef` int NOT NULL,
	`image_url` text,
	`details` text,
	`status` enum('available','unavailable') NOT NULL DEFAULT 'available',
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `products_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `tickets` (
	`id` int AUTO_INCREMENT NOT NULL,
	`draw_id` int NOT NULL,
	`user_id` int NOT NULL,
	`ticket_number` varchar(20) NOT NULL,
	`quantity` int NOT NULL DEFAULT 1,
	`total_paid` int NOT NULL,
	`payment_status` enum('pending','confirmed','failed') NOT NULL DEFAULT 'pending',
	`payment_method` varchar(50) DEFAULT 'pix',
	`pix_qr_code` text,
	`pix_copy_paste` text,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `tickets_id` PRIMARY KEY(`id`),
	CONSTRAINT `tickets_ticket_number_unique` UNIQUE(`ticket_number`)
);
--> statement-breakpoint
CREATE TABLE `utef_balances` (
	`id` int AUTO_INCREMENT NOT NULL,
	`user_id` int NOT NULL,
	`balance` int NOT NULL DEFAULT 0,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `utef_balances_id` PRIMARY KEY(`id`),
	CONSTRAINT `utef_balances_user_id_unique` UNIQUE(`user_id`)
);
--> statement-breakpoint
CREATE TABLE `utef_transactions` (
	`id` int AUTO_INCREMENT NOT NULL,
	`user_id` int NOT NULL,
	`amount` int NOT NULL,
	`type` enum('prize','conversion','adjustment') NOT NULL,
	`description` text,
	`related_id` int,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `utef_transactions_id` PRIMARY KEY(`id`)
);
