-- AlterTable
ALTER TABLE `Purchase` MODIFY `kind` ENUM('CREDITS', 'SUBSCRIPTION', 'AUTO_RECHARGE') NOT NULL;

-- AlterTable
ALTER TABLE `ShopSettings` ADD COLUMN `alertPhone` VARCHAR(191) NULL,
    ADD COLUMN `autoRechargeCap` DECIMAL(10, 2) NULL,
    ADD COLUMN `autoRechargeChargeId` VARCHAR(191) NULL,
    ADD COLUMN `autoRechargeError` TEXT NULL,
    ADD COLUMN `autoRechargeFailedAt` DATETIME(3) NULL,
    ADD COLUMN `autoRechargeInFlight` BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN `autoRechargeLineItemId` VARCHAR(191) NULL,
    ADD COLUMN `lowBalanceNotifiedAt` DATETIME(3) NULL;

-- AlterTable
ALTER TABLE `SmsLog` MODIFY `type` ENUM('NEW_ORDER', 'FULFILLMENT', 'SHIPMENT', 'DELIVERY', 'CANCELLED', 'COD_OTP', 'ABANDONED_CART', 'CAMPAIGN', 'MANUAL', 'TEST', 'ALERT') NOT NULL;

