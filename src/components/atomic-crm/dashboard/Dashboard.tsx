import { LeadMetrics } from "./LeadMetrics";
import { PushNotificationsCard } from "./PushNotificationsCard";

export const Dashboard = () => (
  <div className="mt-1">
    <LeadMetrics />
    <PushNotificationsCard />
  </div>
);
