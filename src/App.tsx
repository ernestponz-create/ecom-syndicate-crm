import { CRM } from "@/components/atomic-crm/root/CRM";

/**
 * Application entry point
 *
 * Customize Atomic CRM by passing props to the CRM component:
 *  - companySectors
 *  - darkTheme
 *  - dealCategories
 *  - dealPipelineStatuses
 *  - dealStages
 *  - lightTheme
 *  - darkModeLogo / lightModeLogo
 *  - noteStatuses
 *  - taskTypes
 *  - title
 * ... as well as all the props accepted by shadcn-admin-kit's <Admin> component.
 *
 * Logos must be an imported asset, an absolute URL, or a data URI — never a
 * route-relative path like "./img/logo.png", which breaks on nested routes.
 *
 * @example
 * import logoDark from "./logo-dark.svg";
 * import logoLight from "./logo-light.svg";
 *
 * const App = () => (
 *    <CRM
 *       darkModeLogo={logoDark}
 *       lightModeLogo={logoLight}
 *       title="Acme CRM"
 *    />
 * );
 */
const App = () => (
  <CRM
    title="The Ecom Syndicate CRM"
    disableTelemetry
    dealStages={[
      { value: "new-lead", label: "New lead" },
      { value: "call-booked", label: "Call booked" },
      { value: "call-done", label: "Call done" },
      { value: "proposal-sent", label: "Proposal sent" },
      { value: "won", label: "Won" },
      { value: "lost", label: "Lost" },
    ]}
    dealPipelineStatuses={["won"]}
    dealCategories={[
      {
        value: "managed-ecommerce-retainer",
        label: "Managed ecommerce retainer",
      },
      { value: "other", label: "Other" },
    ]}
  />
);

export default App;
