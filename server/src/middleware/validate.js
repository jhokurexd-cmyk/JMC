// Zod validation middleware: validate(schema) parses req.body,
// replaces it with the cleaned data, or returns 400 with field errors.
export const validate = (schema) => (req, res, next) => {
  const result = schema.safeParse(req.body)
  if (!result.success) {
    return res.status(400).json({
      error: 'Invalid input',
      fields: result.error.flatten().fieldErrors,
    })
  }
  req.body = result.data
  next()
}
