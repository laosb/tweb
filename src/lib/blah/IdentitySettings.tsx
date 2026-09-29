import Section from '@components/section';
import {useSuperTab} from '@components/solidJsTabs/superTabProvider';
import IdentityPanel from '@lib/blah/IdentityPanel';

export default function IdentitySettings() {
  const [tab] = useSuperTab();
  return <Section><IdentityPanel action={(request) => tab.managers.appAccountManager.blahIdentity(request)} /></Section>;
}
