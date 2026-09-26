import { getAuthSession } from '../../auth';
import { Callback } from '../../pages/Callback';

export default function OidcCallbackRoute() {
  return <Callback session={getAuthSession()} />;
}
