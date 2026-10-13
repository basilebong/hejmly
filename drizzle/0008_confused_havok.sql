DROP INDEX `accounts_issuer_accountId_uidx`;--> statement-breakpoint
CREATE UNIQUE INDEX `accounts_provider_account_unique` ON `accounts` (`provider_id`,`account_id`);--> statement-breakpoint
ALTER TABLE `accounts` DROP COLUMN `issuer`;