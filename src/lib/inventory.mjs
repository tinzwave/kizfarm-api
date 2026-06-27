import Product from "../models/Product.mjs";

function inventoryError(message, status = 400) {
  const error = new Error(message);
  error.status = status;
  return error;
}

export async function decrementStockForOrder(order) {
  if (!order || order.stockAdjusted) return order;

  const adjustedItems = [];
  try {
    for (const item of order.items || []) {
      const quantity = Math.max(1, Number(item.quantity || 1));
      const product = await Product.findById(item.productId).select("name quantity unit");
      if (!product) {
        throw inventoryError(`${item.name || "Product"} no longer exists.`);
      }

      if (product.quantity === null || product.quantity === undefined) {
        continue;
      }

      if (product.quantity < quantity) {
        throw inventoryError(
          `${product.name} only has ${product.quantity} ${product.unit || "units"} in stock.`,
        );
      }

      const update = await Product.updateOne(
        { _id: product._id, quantity: { $gte: quantity } },
        { $inc: { quantity: -quantity } },
      );

      if (update.modifiedCount !== 1) {
        throw inventoryError(`${product.name} stock changed. Please try again.`);
      }

      adjustedItems.push({ productId: product._id, quantity });
    }

    order.stockAdjusted = true;
    order.stockAdjustedAt = new Date();
    await order.save();
    return order;
  } catch (error) {
    for (const adjusted of adjustedItems.reverse()) {
      await Product.updateOne(
        { _id: adjusted.productId },
        { $inc: { quantity: adjusted.quantity } },
      );
    }
    throw error;
  }
}

export async function restoreStockForOrder(order) {
  if (!order || !order.stockAdjusted) return order;

  for (const item of order.items || []) {
    const quantity = Math.max(1, Number(item.quantity || 1));
    await Product.updateOne(
      { _id: item.productId, quantity: { $ne: null } },
      { $inc: { quantity } },
    );
  }

  order.stockAdjusted = false;
  order.stockAdjustedAt = null;
  await order.save();
  return order;
}
