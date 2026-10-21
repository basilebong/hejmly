PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_grocery_items` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`status_json` text NOT NULL,
	`added_by_user_id` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`purchased_at` integer,
	FOREIGN KEY (`added_by_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
INSERT INTO `__new_grocery_items`("id", "name", "description", "status_json", "added_by_user_id", "created_at", "updated_at", "purchased_at") SELECT "id", "name", "description", "status_json", "added_by_user_id", "created_at", "updated_at", "purchased_at" FROM `grocery_items`;--> statement-breakpoint
DROP TABLE `grocery_items`;--> statement-breakpoint
ALTER TABLE `__new_grocery_items` RENAME TO `grocery_items`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `grocery_items_purchased_at_idx` ON `grocery_items` (`purchased_at`);--> statement-breakpoint
CREATE INDEX `grocery_items_created_at_idx` ON `grocery_items` (`created_at`);--> statement-breakpoint
CREATE TABLE `__new_recipes` (
	`id` text PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`description` text NOT NULL,
	`image` text,
	`category` text NOT NULL,
	`minutes` integer NOT NULL,
	`serves` integer NOT NULL,
	`ingredients_json` text NOT NULL,
	`steps_json` text NOT NULL,
	`created_by_user_id` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`created_by_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
INSERT INTO `__new_recipes`("id", "title", "description", "image", "category", "minutes", "serves", "ingredients_json", "steps_json", "created_by_user_id", "created_at", "updated_at") SELECT "id", "title", "description", "image", "category", "minutes", "serves", "ingredients_json", "steps_json", "created_by_user_id", "created_at", "updated_at" FROM `recipes`;--> statement-breakpoint
DROP TABLE `recipes`;--> statement-breakpoint
ALTER TABLE `__new_recipes` RENAME TO `recipes`;--> statement-breakpoint
CREATE INDEX `recipes_created_at_idx` ON `recipes` (`created_at`);--> statement-breakpoint
CREATE INDEX `recipes_category_idx` ON `recipes` (`category`);