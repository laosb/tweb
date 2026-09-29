import {useSuperTab} from '@components/solidJsTabs/superTabProvider';
import type {AppBlahIdentityDetailsTab} from '@components/solidJsTabs/tabs';
import {onCleanup} from 'solid-js';
import styles from '@lib/blah/identity.module.scss';
import {IdentityDetails} from '@lib/blah/IdentityDetails';

export default function IdentityDetailsSettings() {
  const [tab] = useSuperTab<typeof AppBlahIdentityDetailsTab>();
  tab.scrollable.container.classList.add(styles.detailsSettings);
  onCleanup(() => tab.scrollable.container.classList.remove(styles.detailsSettings));
  return <IdentityDetails {...tab.payload} onExit={() => tab.close()} />;
}
