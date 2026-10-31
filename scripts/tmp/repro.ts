import { getReadiness } from "../../lib/readiness/store";
try {
  getReadiness("s1");
  console.log("NO ERROR — hypothesis wrong");
} catch (e: any) {
  console.log("THROWS:", e.code, "|", e.message);
}
