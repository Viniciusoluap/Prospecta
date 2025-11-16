ALTER TABLE `tickets` ADD `stripe_payment_intent_id` varchar(255);--> statement-breakpoint
ALTER TABLE `tickets` ADD `stripe_checkout_session_id` varchar(255);