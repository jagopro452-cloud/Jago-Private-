import { lazy, Suspense, useEffect } from "react";
import type { ComponentType } from "react";
import { Switch, Route, Redirect, useLocation } from "wouter";
import AdminLayout, { canAccessAdminPath } from "@/pages/admin/layout";
import { AdminEmptyState, AdminErrorBoundary, AdminLoader } from "@/pages/admin/components/AdminPrimitives";
import { getSavedAdminSession } from "@/lib/queryClient";

const loadDashboard = () => import("@/pages/admin/dashboard");
const loadTrips = () => import("@/pages/admin/trips");
const loadCustomers = () => import("@/pages/admin/customers");
const loadDrivers = () => import("@/pages/admin/drivers");
const loadVehicleCategories = () => import("@/pages/admin/vehicle-categories");
const loadZones = () => import("@/pages/admin/zones");
const loadFares = () => import("@/pages/admin/fares");
const loadTransactions = () => import("@/pages/admin/transactions");
const loadCoupons = () => import("@/pages/admin/coupons");
const loadReviews = () => import("@/pages/admin/reviews");
const loadSettings = () => import("@/pages/admin/settings");
const loadBlogsPage = () => import("@/pages/admin/blogs");
const loadWithdrawals = () => import("@/pages/admin/withdrawals");
const loadCancellationReasonsPage = () => import("@/pages/admin/cancellation-reasons");
const loadHeatMap = () => import("@/pages/admin/heat-map");
const loadRealtimeOps = () => import("@/pages/admin/realtime-ops");
const loadFleetView = () => import("@/pages/admin/fleet-view");
const loadParcelRefunds = () => import("@/pages/admin/parcel-refunds");
const loadSafetyAlerts = () => import("@/pages/admin/safety-alerts");
const loadAlertEngine = () => import("@/pages/admin/alert-engine");
const loadBanners = () => import("@/pages/admin/banners");
const loadDiscounts = () => import("@/pages/admin/discounts");
const loadSpinWheel = () => import("@/pages/admin/spin-wheel");
const loadNotifications = () => import("@/pages/admin/notifications");
const loadDriverLevels = () => import("@/pages/admin/driver-levels");
const loadCustomerLevels = () => import("@/pages/admin/customer-levels");
const loadCustomerWallet = () => import("@/pages/admin/customer-wallet");
const loadWalletBonus = () => import("@/pages/admin/wallet-bonus");
const loadEmployees = () => import("@/pages/admin/employees");
const loadNewsletter = () => import("@/pages/admin/newsletter");
const loadSubscriptions = () => import("@/pages/admin/subscriptions");
const loadRevenueModel = () => import("@/pages/admin/revenue-model");
const loadDriverWalletPage = () => import("@/pages/admin/driver-wallet");
const loadRefundRequestsPage = () => import("@/pages/admin/refund-requests");
const loadApiDocsPage = () => import("@/pages/admin/api-docs");
const loadAppDesignPage = () => import("@/pages/admin/app-design");
const loadLanguagesPage = () => import("@/pages/admin/languages");
const loadServiceManagement = () => import("@/pages/admin/service-management");
const loadParcelAttributes = () => import("@/pages/admin/parcel-attributes");
const loadVehicleAttributes = () => import("@/pages/admin/vehicle-attributes");
const loadVehicleRequests = () => import("@/pages/admin/vehicle-requests");
const loadParcelFares = () => import("@/pages/admin/parcel-fares");
const loadSurgePricing = () => import("@/pages/admin/surge-pricing");
const loadReports = () => import("@/pages/admin/reports");
const loadChatting = () => import("@/pages/admin/chatting");
const loadCallLogs = () => import("@/pages/admin/call-logs");
const loadBusinessSetup = () => import("@/pages/admin/business-setup");
const loadPagesMedia = () => import("@/pages/admin/pages-media");
const loadConfigurations = () => import("@/pages/admin/configurations");
const loadB2BCompanies = () => import("@/pages/admin/b2b-companies");
const loadIntercityRoutes = () => import("@/pages/admin/intercity-routes");
const loadInsurance = () => import("@/pages/admin/insurance");
const loadDriverEarnings = () => import("@/pages/admin/driver-earnings");
const loadReferrals = () => import("@/pages/admin/referrals");
const loadDriverVerificationPage = () => import("@/pages/admin/driver-verification");
const loadLocalPool = () => import("@/pages/admin/local-pool");
const loadIntercityPool = () => import("@/pages/admin/intercity-carsharing");
const loadOutstationPool = () => import("@/pages/admin/outstation-pool");
const loadParcelOrders = () => import("@/pages/admin/parcel-orders");
const loadSystemHealth = () => import("@/pages/admin/system-health");
const loadVoiceCommandsPage = () => import("@/pages/admin/voice-commands");
const loadCityServices = () => import("@/pages/admin/city-services");
const loadParcelVehiclesAdmin = () => import("@/pages/admin/parcel-vehicles");
const loadAIBrainDashboard = () => import("@/pages/admin/ai-brain-dashboard");
const loadFranchisees = () => import("@/pages/admin/franchisees");
const loadCarSharing = () => import("@/pages/admin/car-sharing");
const loadFareManagementOverview = () => import("@/pages/admin/fare-management-overview");
const loadFareSimulator = () => import("@/pages/admin/fare-simulator");
const loadPricingAuditLogs = () => import("@/pages/admin/pricing-audit-logs");

const Dashboard = lazy(loadDashboard);
const Trips = lazy(loadTrips);
const Customers = lazy(loadCustomers);
const Drivers = lazy(loadDrivers);
const VehicleCategories = lazy(loadVehicleCategories);
const Zones = lazy(loadZones);
const Fares = lazy(loadFares);
const Transactions = lazy(loadTransactions);
const Coupons = lazy(loadCoupons);
const Reviews = lazy(loadReviews);
const Settings = lazy(loadSettings);
const BlogsPage = lazy(loadBlogsPage);
const Withdrawals = lazy(loadWithdrawals);
const CancellationReasonsPage = lazy(loadCancellationReasonsPage);
const HeatMap = lazy(loadHeatMap);
const RealtimeOps = lazy(loadRealtimeOps);
const FleetView = lazy(loadFleetView);
const ParcelRefunds = lazy(loadParcelRefunds);
const SafetyAlerts = lazy(loadSafetyAlerts);
const AlertEngine = lazy(loadAlertEngine);
const Banners = lazy(loadBanners);
const Discounts = lazy(loadDiscounts);
const SpinWheel = lazy(loadSpinWheel);
const Notifications = lazy(loadNotifications);
const DriverLevels = lazy(loadDriverLevels);
const CustomerLevels = lazy(loadCustomerLevels);
const CustomerWallet = lazy(loadCustomerWallet);
const WalletBonus = lazy(loadWalletBonus);
const Employees = lazy(loadEmployees);
const Newsletter = lazy(loadNewsletter);
const Subscriptions = lazy(loadSubscriptions);
const RevenueModel = lazy(loadRevenueModel);
const DriverWalletPage = lazy(loadDriverWalletPage);
const RefundRequestsPage = lazy(loadRefundRequestsPage);
const ApiDocsPage = lazy(loadApiDocsPage);
const AppDesignPage = lazy(loadAppDesignPage);
const LanguagesPage = lazy(loadLanguagesPage);
const ServiceManagement = lazy(loadServiceManagement);
const ParcelAttributes = lazy(loadParcelAttributes);
const VehicleAttributes = lazy(loadVehicleAttributes);
const VehicleRequests = lazy(loadVehicleRequests);
const ParcelFares = lazy(loadParcelFares);
const SurgePricing = lazy(loadSurgePricing);
const Reports = lazy(loadReports);
const Chatting = lazy(loadChatting);
const CallLogs = lazy(loadCallLogs);
const BusinessSetup = lazy(loadBusinessSetup);
const PagesMedia = lazy(loadPagesMedia);
const Configurations = lazy(loadConfigurations);
const B2BCompanies = lazy(loadB2BCompanies);
const IntercityRoutes = lazy(loadIntercityRoutes);
const Insurance = lazy(loadInsurance);
const DriverEarnings = lazy(loadDriverEarnings);
const Referrals = lazy(loadReferrals);
const DriverVerificationPage = lazy(loadDriverVerificationPage);
const LocalPool = lazy(loadLocalPool);
const IntercityPool = lazy(loadIntercityPool);
const OutstationPool = lazy(loadOutstationPool);
const ParcelOrders = lazy(loadParcelOrders);
const SystemHealth = lazy(loadSystemHealth);
const VoiceCommandsPage = lazy(loadVoiceCommandsPage);
const CityServices = lazy(loadCityServices);
const ParcelVehiclesAdmin = lazy(loadParcelVehiclesAdmin);
const AIBrainDashboard = lazy(loadAIBrainDashboard);
const Franchisees = lazy(loadFranchisees);
const CarSharing = lazy(loadCarSharing);
const FareManagementOverview = lazy(loadFareManagementOverview);
const FareSimulator = lazy(loadFareSimulator);
const PricingAuditLogs = lazy(loadPricingAuditLogs);

// Map-heavy pages (zones, heat-map, fleet-view) are intentionally excluded from
// preload — Leaflet (149KB) should only load when the user navigates to those pages.
const preloadAdminModules = [
  loadDashboard,
  loadTrips,
  loadCustomers,
  loadDrivers,
  loadRealtimeOps,
  loadServiceManagement,
  loadDiscounts,
  loadCoupons,
  loadReports,
  loadChatting,
];

function AdminPageFallback() {
  return <AdminLoader label="Opening module..." />;
}

function AdminRouteMissing() {
  return (
    <AdminEmptyState
      icon="bi-exclamation-diamond-fill"
      title="Module Not Found"
      message="This admin route is not mapped to a live module in the current build."
    />
  );
}

function AdminAccessDenied() {
  return (
    <AdminEmptyState
      icon="bi-shield-lock-fill"
      title="Access denied"
      message="Your admin role is not allowed to open this module."
    />
  );
}

function ProtectedAdminPage({ path, component: Component }: { path: string; component: ComponentType<any> }) {
  const session = getSavedAdminSession();
  if (!canAccessAdminPath(session.role, path)) return <AdminAccessDenied />;
  return <Component />;
}

function GuardedRoute({ path, component }: { path: string; component: ComponentType<any> }) {
  return (
    <Route path={path}>
      <ProtectedAdminPage path={path} component={component} />
    </Route>
  );
}

export default function AdminRoutes() {
  const [location] = useLocation();

  useEffect(() => {
    const run = () => {
      preloadAdminModules.forEach((loader, index) => {
        setTimeout(() => {
          loader().catch(() => undefined);
        }, index * 80);
      });
    };

    if ("requestIdleCallback" in window) {
      const idleId = (window as any).requestIdleCallback(run, { timeout: 1200 });
      return () => (window as any).cancelIdleCallback?.(idleId);
    }

    const timeoutId = setTimeout(run, 500);
    return () => clearTimeout(timeoutId);
  }, []);

  useEffect(() => {
    window.scrollTo({ top: 0, left: 0, behavior: "auto" });
    document.documentElement.scrollTop = 0;
    document.body.scrollTop = 0;
    document.querySelectorAll(".main-area, .admin-main-area, .main-area-inner, .admin-main-inner").forEach((node) => {
      if (node instanceof HTMLElement) {
        node.scrollTop = 0;
        node.scrollLeft = 0;
      }
    });
  }, [location]);

  return (
    <AdminLayout>
      <AdminErrorBoundary>
      <Suspense fallback={<AdminPageFallback />}>
        <Switch>
          <Route path="/admin/intercity-carsharing">
            <Redirect to="/admin/intercity-pool" />
          </Route>
          <GuardedRoute path="/admin/car-sharing" component={CarSharing} />
          <GuardedRoute path="/admin/fare-management" component={FareManagementOverview} />
          <GuardedRoute path="/admin/fare-simulator" component={FareSimulator} />
          <GuardedRoute path="/admin/pricing-audit-logs" component={PricingAuditLogs} />
          <GuardedRoute path="/admin/dashboard" component={Dashboard} />
          <GuardedRoute path="/admin/realtime-ops" component={RealtimeOps} />
          <GuardedRoute path="/admin/heat-map" component={HeatMap} />
          <GuardedRoute path="/admin/fleet-view" component={FleetView} />
          <GuardedRoute path="/admin/zones" component={Zones} />
          <Route path="/admin/popular-locations">
            <Redirect to="/admin/zones" />
          </Route>
          <GuardedRoute path="/admin/trips" component={Trips} />
          <GuardedRoute path="/admin/intercity-pool" component={IntercityPool} />
          <GuardedRoute path="/admin/local-pool" component={LocalPool} />
          <GuardedRoute path="/admin/outstation-pool" component={OutstationPool} />
          <GuardedRoute path="/admin/parcel-refunds" component={ParcelRefunds} />
          <GuardedRoute path="/admin/safety-alerts" component={SafetyAlerts} />
          <GuardedRoute path="/admin/alert-engine" component={AlertEngine} />
          <GuardedRoute path="/admin/banners" component={Banners} />
          <GuardedRoute path="/admin/coupons" component={Coupons} />
          <GuardedRoute path="/admin/discounts" component={Discounts} />
          <GuardedRoute path="/admin/spin-wheel" component={SpinWheel} />
          <GuardedRoute path="/admin/notifications" component={Notifications} />
          <GuardedRoute path="/admin/driver-levels" component={DriverLevels} />
          <GuardedRoute path="/admin/driver-verification" component={DriverVerificationPage} />
          <GuardedRoute path="/admin/drivers" component={Drivers} />
          <GuardedRoute path="/admin/withdrawals" component={Withdrawals} />
          <GuardedRoute path="/admin/customer-levels" component={CustomerLevels} />
          <GuardedRoute path="/admin/customers" component={Customers} />
          <GuardedRoute path="/admin/customer-wallet" component={CustomerWallet} />
          <GuardedRoute path="/admin/wallet-bonus" component={WalletBonus} />
          <GuardedRoute path="/admin/employees" component={Employees} />
          <GuardedRoute path="/admin/newsletter" component={Newsletter} />
          <GuardedRoute path="/admin/subscriptions" component={Subscriptions} />
          <GuardedRoute path="/admin/revenue-model" component={RevenueModel} />
          <GuardedRoute path="/admin/parcel-attributes" component={ParcelAttributes} />
          <GuardedRoute path="/admin/vehicle-attributes" component={VehicleAttributes} />
          <GuardedRoute path="/admin/vehicles" component={VehicleCategories} />
          <GuardedRoute path="/admin/vehicle-requests" component={VehicleRequests} />
          <GuardedRoute path="/admin/fares" component={Fares} />
          <GuardedRoute path="/admin/cancellation-reasons" component={CancellationReasonsPage} />
          <GuardedRoute path="/admin/parcel-fares" component={ParcelFares} />
          <GuardedRoute path="/admin/surge-pricing" component={SurgePricing} />
          <GuardedRoute path="/admin/transactions" component={Transactions} />
          <GuardedRoute path="/admin/reports" component={Reports} />
          <GuardedRoute path="/admin/chatting" component={Chatting} />
          <GuardedRoute path="/admin/call-logs" component={CallLogs} />
          <GuardedRoute path="/admin/blogs" component={BlogsPage} />
          <GuardedRoute path="/admin/reviews" component={Reviews} />
          <GuardedRoute path="/admin/business-setup" component={BusinessSetup} />
          <GuardedRoute path="/admin/pages-media" component={PagesMedia} />
          <GuardedRoute path="/admin/configurations" component={Configurations} />
          <GuardedRoute path="/admin/settings" component={Settings} />
          <GuardedRoute path="/admin/b2b-companies" component={B2BCompanies} />
          <GuardedRoute path="/admin/intercity-routes" component={IntercityRoutes} />
          <GuardedRoute path="/admin/insurance" component={Insurance} />
          <GuardedRoute path="/admin/driver-earnings" component={DriverEarnings} />
          <GuardedRoute path="/admin/driver-wallet" component={DriverWalletPage} />
          <GuardedRoute path="/admin/refund-requests" component={RefundRequestsPage} />
          <GuardedRoute path="/admin/api-docs" component={ApiDocsPage} />
          <GuardedRoute path="/admin/app-design" component={AppDesignPage} />
          <GuardedRoute path="/admin/languages" component={LanguagesPage} />
          <GuardedRoute path="/admin/service-management" component={ServiceManagement} />
          <GuardedRoute path="/admin/parcel-orders" component={ParcelOrders} />
          <GuardedRoute path="/admin/system-health" component={SystemHealth} />
          <GuardedRoute path="/admin/voice-commands" component={VoiceCommandsPage} />
          <GuardedRoute path="/admin/referrals" component={Referrals} />
          <GuardedRoute path="/admin/city-services" component={CityServices} />
          <GuardedRoute path="/admin/parcel-vehicle-types" component={ParcelVehiclesAdmin} />
          <GuardedRoute path="/admin/ai-brain" component={AIBrainDashboard} />
          <GuardedRoute path="/admin/franchisees" component={Franchisees} />
          <Route component={AdminRouteMissing} />
        </Switch>
      </Suspense>
      </AdminErrorBoundary>
    </AdminLayout>
  );
}
