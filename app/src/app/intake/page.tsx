import { Questionnaire } from "./questionnaire";

/** The session is resolved client-side from the httpOnly intake cookie via /api/intake/current. */
export default function IntakePage() {
  return <Questionnaire />;
}
