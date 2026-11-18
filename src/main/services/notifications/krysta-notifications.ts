import { Notification } from "electron";
import { LocalNotificationManager } from "./local-notifications";
import type { LocalNotificationType } from "@types";

export async function publishKrystaNotification(
  type: LocalNotificationType,
  title: string,
  description: string,
  desktop = false
) {
  try {
    await LocalNotificationManager.createNotification(type, title, description);
  } catch (error) {
    console.error("Krysta notification persistence failed", error);
  }
  if (desktop && Notification.isSupported()) {
    try {
      new Notification({ title, body: description }).show();
    } catch {
      /* history remains available */
    }
  }
}
