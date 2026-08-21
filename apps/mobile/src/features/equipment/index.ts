export {
  fetchEquipment,
  createEquipment,
  updateEquipment,
  type Equipment,
  type EquipmentCategory,
  type EquipmentStatus,
  type CreateEquipmentInput,
  type UpdateEquipmentInput,
} from './api/equipment.api';
export { useEquipment, useCreateEquipment, useUpdateEquipment } from './hooks/use-equipment';
