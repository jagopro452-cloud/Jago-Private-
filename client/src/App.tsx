import { Switch, Route, Redirect, useLocation } from "wouter";
import { Suspense, lazy, useEffect } from "react";
import { logoutAdminSession, queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ThemeProvider } from "@/components/theme-provider";

const LandingPage = lazy(() => import("@/pages/landing"));
const AdminLogin = lazy(() => import("@/pages/admin/login"));
const AdminRoutes = lazy(() => import("@/pages/admin/admin-routes"));
const FranchiseLogin = lazy(() => import("@/pages/franchise/franchise-login"));
const FranchiseDashboard = lazy(() => import("@/pages/franchise/franchise-dashboard"));
const NotFound = lazy(() => import("@/pages/not-found"));
const AboutPage = lazy(() => import("@/pages/policy-pages").then((m) => ({ default: m.AboutPage })));
const PrivacyPage = lazy(() => import("@/pages/policy-pages").then((m) => ({ default: m.PrivacyPage })));
const TermsPage = lazy(() => import("@/pages/policy-pages").then((m) => ({ default: m.TermsPage })));
const RefundPolicyPage = lazy(() => import("@/pages/policy-pages").then((m) => ({ default: m.RefundPolicyPage })));
const CookiePolicyPage = lazy(() => import("@/pages/policy-pages").then((m) => ({ default: m.CookiePolicyPage })));
const ContactPage = lazy(() => import("@/pages/policy-pages").then((m) => ({ default: m.ContactPage })));

function AdminLogout() {
  const [, setLocation] = useLocation();
  useEffect(() => {
    logoutAdminSession()
      .catch(() => undefined)
      .finally(() => {
        queryClient.clear();
        setLocation("/admin/login");
      });
  }, [setLocation]);
  return null;
}

function RouteFallback() {
  return (
    <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: "#f8fafc", color: "#0f172a", fontFamily: "'Manrope', 'Segoe UI', sans-serif", fontWeight: 700 }}>
      Loading...
    </div>
  );
}

function Router() {
  const [location] = useLocation();

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (window.location.hash) return;
    if (location.startsWith("/admin/")) return;
    window.scrollTo({ top: 0, left: 0, behavior: "auto" });
  }, [location]);

  return (
    <Switch>
      <Route path="/" component={LandingPage} />
      <Route path="/about-us" component={AboutPage} />
      <Route path="/privacy" component={PrivacyPage} />
      <Route path="/terms" component={TermsPage} />
      <Route path="/refund-policy" component={RefundPolicyPage} />
      <Route path="/cookie-policy" component={CookiePolicyPage} />
      <Route path="/contact-us" component={ContactPage} />
      <Route path="/admin/login" component={AdminLogin} />
      <Route path="/admin/auth/login" component={AdminLogin} />
      <Route path="/admin/auth/logout" component={AdminLogout} />
      <Route path="/admin">
        <Redirect to="/admin/dashboard" />
      </Route>
      <Route path="/admin/:rest*" component={AdminRoutes} />
      <Route path="/franchise">
        <Redirect to="/franchise/login" />
      </Route>
      <Route path="/franchise/login" component={FranchiseLogin} />
      <Route path="/franchise/dashboard" component={FranchiseDashboard} />
      <Route component={NotFound} />
    </Switch>
  );
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <TooltipProvider>
          <Toaster />
          <Suspense fallback={<RouteFallback />}>
            <Router />
          </Suspense>
        </TooltipProvider>
      </ThemeProvider>
    </QueryClientProvider>
  );
}
