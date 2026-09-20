import { Suspense } from 'react'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import AssessmentPage from '../../../components/AssessmentPage'

export default function PhotographerAssessmentPage() {
  return <Page><PageBody><Suspense><AssessmentPage /></Suspense></PageBody></Page>
}
