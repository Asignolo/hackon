import { Suspense } from 'react'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import DemoScenario from '../../../components/DemoScenario'

export default function PhotographerDemoPage() {
  return <Page><PageBody><Suspense><DemoScenario /></Suspense></PageBody></Page>
}
