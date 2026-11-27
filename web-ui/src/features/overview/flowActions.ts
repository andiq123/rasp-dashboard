import { createContext } from 'react'

/** Actions a flow popup can trigger on the Overview (kept out of the diagram's props). */
export const FlowActions = createContext<{ editResidentialBalance?: () => void }>({})
