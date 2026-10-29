import { LegacySignup } from "./legacy-signup";
import { SignupFlow } from "@/components/join/signup-flow";
import { isJoinEnvEnabled } from "@/lib/join-by-code";

// the flag is read on every request (never frozen at build time): flag off = today's sign-up page, exactly
export const dynamic = "force-dynamic";

export default function SignupPage() {
  return isJoinEnvEnabled() ? <SignupFlow /> : <LegacySignup />;
}
