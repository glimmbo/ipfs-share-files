import { useContext } from 'react'
import { NodePinContext, type NodePinContextType } from '../providers/node-pin-provider'

export const useNodePin = (): NodePinContextType => {
  return useContext(NodePinContext)
}
