PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_todo_tasks` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`title` text NOT NULL,
	`notes` text,
	`status_json` text NOT NULL,
	`due_on` text,
	`assignee_user_id` text,
	`added_by_user_id` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`completed_at` integer,
	FOREIGN KEY (`project_id`) REFERENCES `todo_projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`assignee_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`added_by_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
INSERT INTO `__new_todo_tasks`("id", "project_id", "title", "notes", "status_json", "due_on", "assignee_user_id", "added_by_user_id", "created_at", "updated_at", "completed_at") SELECT "id", "project_id", "title", "notes", "status_json", "due_on", "assignee_user_id", "added_by_user_id", "created_at", "updated_at", "completed_at" FROM `todo_tasks`;--> statement-breakpoint
DROP TABLE `todo_tasks`;--> statement-breakpoint
ALTER TABLE `__new_todo_tasks` RENAME TO `todo_tasks`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `todo_tasks_project_id_idx` ON `todo_tasks` (`project_id`,`created_at`);