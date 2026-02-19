export interface IPromptExample {
    prompt: string;
    code: string;
}

export const Build123dExamples: IPromptExample[] = [
{
    prompt: "Create a box 10x10x10mm",
    code: `
# Create a simple 10x10x10mm cube
root_part = Solid.make_box(10, 10, 10)
`},
];