import { useCallback, useEffect, useState } from "react";
import { Bell, BellOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

import { getSupabaseClient } from "../providers/supabase/supabase";

// Public VAPID key (safe to ship). The private key lives only in the
// push-new-lead Edge Function secrets.
const VAPID_PUBLIC_KEY =
  "BEKpyTkkSlt1SZuRzzJAtAiu2Cl3vRNMVvJt6ABMLmZSliVsvRP66rB9Vl-2XxA8j0yXhLb5Ax2INjoDt1Rpbww";

type PushState =
  | "checking"
  | "on"
  | "off"
  | "blocked"
  | "not-installed"
  | "unsupported";

const isIOS = () =>
  /iPad|iPhone|iPod/.test(navigator.userAgent) ||
  (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);

const isStandalone = () =>
  window.matchMedia?.("(display-mode: standalone)").matches ||
  (navigator as unknown as { standalone?: boolean }).standalone === true;

const pushSupported = () =>
  "serviceWorker" in navigator &&
  "PushManager" in window &&
  "Notification" in window;

const urlBase64ToUint8Array = (base64: string) => {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const raw = atob((base64 + padding).replace(/-/g, "+").replace(/_/g, "/"));
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
};

const saveSubscription = async (sub: PushSubscription) => {
  const json = sub.toJSON();
  const supabase = getSupabaseClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) throw new Error("Please log in again.");
  const { error } = await supabase.from("push_subscriptions").upsert(
    {
      user_id: auth.user.id,
      endpoint: sub.endpoint,
      p256dh: json.keys?.p256dh ?? "",
      auth: json.keys?.auth ?? "",
      user_agent: navigator.userAgent.slice(0, 500),
    },
    { onConflict: "user_id,endpoint" },
  );
  if (error) throw new Error(error.message);
};

const getRegistration = async () => {
  const existing = await navigator.serviceWorker.getRegistration();
  return existing ?? navigator.serviceWorker.ready;
};

export const PushNotificationsCard = () => {
  const [state, setState] = useState<PushState>("checking");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!pushSupported()) {
      setState(isIOS() && !isStandalone() ? "not-installed" : "unsupported");
      return;
    }
    if (isIOS() && !isStandalone()) {
      setState("not-installed");
      return;
    }
    if (Notification.permission === "denied") {
      setState("blocked");
      return;
    }
    try {
      const reg = await getRegistration();
      const sub = await reg.pushManager.getSubscription();
      if (sub && Notification.permission === "granted") {
        // Keep the server copy in sync (e.g. if it was cleaned up as expired).
        saveSubscription(sub).catch(() => undefined);
        setState("on");
      } else {
        setState("off");
      }
    } catch {
      setState("off");
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  // Must run directly from a user tap: iOS only shows the prompt then.
  const turnOn = async () => {
    setMessage(null);
    setBusy(true);
    try {
      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        setState(permission === "denied" ? "blocked" : "off");
        return;
      }
      const reg = await getRegistration();
      let sub = await reg.pushManager.getSubscription();
      if (!sub) {
        sub = await reg.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
        });
      }
      await saveSubscription(sub);
      setState("on");
      setMessage("Notifications are on for this device.");
    } catch (e) {
      setMessage(
        `Could not turn on notifications: ${e instanceof Error ? e.message : String(e)}`,
      );
    } finally {
      setBusy(false);
    }
  };

  const turnOff = async () => {
    setMessage(null);
    setBusy(true);
    try {
      const reg = await getRegistration();
      const sub = await reg.pushManager.getSubscription();
      if (sub) {
        await getSupabaseClient()
          .from("push_subscriptions")
          .delete()
          .eq("endpoint", sub.endpoint);
        await sub.unsubscribe();
      }
      setState("off");
      setMessage("Notifications are off for this device.");
    } catch (e) {
      setMessage(
        `Could not turn off notifications: ${e instanceof Error ? e.message : String(e)}`,
      );
    } finally {
      setBusy(false);
    }
  };

  if (!import.meta.env.VITE_SUPABASE_URL) return null;

  const status: Record<PushState, string> = {
    checking: "Checking…",
    on: "On",
    off: "Off",
    blocked: "Blocked",
    "not-installed": "Not available yet",
    unsupported: "Not supported",
  };

  return (
    <Card className="gap-2 py-4 mt-4">
      <CardHeader className="px-4">
        <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
          {state === "on" ? (
            <Bell className="size-4" />
          ) : (
            <BellOff className="size-4" />
          )}
          New lead notifications: {status[state]}
        </CardTitle>
      </CardHeader>
      <CardContent className="px-4 flex flex-col gap-2 text-sm">
        {state === "off" && (
          <Button onClick={turnOn} disabled={busy} className="w-fit">
            <Bell className="size-4" />
            Turn on notifications
          </Button>
        )}
        {state === "on" && (
          <Button
            variant="outline"
            onClick={turnOff}
            disabled={busy}
            className="w-fit"
          >
            <BellOff className="size-4" />
            Turn off on this device
          </Button>
        )}
        {state === "not-installed" && (
          <p className="text-muted-foreground">
            On iPhone, notifications only work from the Home Screen app. Tap the
            Share button, then “Add to Home Screen”, then open the CRM from the
            new icon and come back here.
          </p>
        )}
        {state === "blocked" && (
          <p className="text-muted-foreground">
            Notifications are blocked for this app. On iPhone go to Settings →
            Notifications → Ecom CRM and turn on Allow Notifications, then
            reopen the app.
          </p>
        )}
        {state === "unsupported" && (
          <p className="text-muted-foreground">
            This browser can't receive push notifications. On iPhone, update to
            iOS 16.4 or newer and open the CRM from the Home Screen icon.
          </p>
        )}
        {message && <p className="text-muted-foreground">{message}</p>}
      </CardContent>
    </Card>
  );
};
