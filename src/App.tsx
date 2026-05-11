/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { MainLayout } from './components/MainLayout';
import { TooltipProvider } from '@/components/ui/tooltip';

export default function App() {
  return (
    <TooltipProvider>
      <MainLayout />
    </TooltipProvider>
  );
}

