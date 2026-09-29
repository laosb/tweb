import Section from '@components/section';
import rootScope from '@lib/rootScope';
import IdentityPanel from '@lib/blah/IdentityPanel';

export default function IdentitySettings() {
  return <Section><IdentityPanel action={(request) => rootScope.managers.appAccountManager.blahIdentity(request)} /></Section>;
}
