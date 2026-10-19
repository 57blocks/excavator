import { Button, Card, CardTitle } from '@/components/ui';
import Pill from '../components/ui/badge';
import * as Icons from '../components/icons';
import { Link } from 'react-router';
import { Fancy } from '@/components/ui/dialog';

export default function Home({ Slot }: { Slot: () => unknown }) {
  return (
    <Card>
      <CardTitle>Home</CardTitle>
      <Button label="Go" />
      <Pill />
      <Icons.StarIcon />
      <Link to="/" />
      <Slot />
      <Fancy />
      <my-widget />
      <section />
    </Card>
  );
}

export const routes = [<Home key="home" Slot={() => null} />];
