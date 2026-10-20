import { createRootRoute, createRoute, createRouter } from "@tanstack/react-router";
import * as v from "valibot";

import { AppShell } from "@/components/AppShell";
import { AuthGuard } from "@/components/AuthGuard";
import { AppsScreen } from "@/features/apps/AppsScreen";
import { CheckingScreen } from "@/features/auth/CheckingScreen";
import { ConsentScreen } from "@/features/auth/ConsentScreen";
import { FirstArrivalScreen } from "@/features/auth/FirstArrivalScreen";
import { RejectedScreen } from "@/features/auth/RejectedScreen";
import { SignInScreen } from "@/features/auth/SignInScreen";
import { GroceryScreen } from "@/features/grocery/GroceryScreen";
import { MeScreen } from "@/features/me/MeScreen";
import { CreateRecipeScreen } from "@/features/recipes/CreateRecipeScreen";
import { EditRecipeScreen } from "@/features/recipes/EditRecipeScreen";
import { RecipeDetailScreen } from "@/features/recipes/RecipeDetailScreen";
import { RecipesScreen } from "@/features/recipes/RecipesScreen";
import { ProjectScreen } from "@/features/todo/ProjectScreen";
import { ProjectsScreen } from "@/features/todo/ProjectsScreen";

export const rootRoute = createRootRoute({
  component: AppShell,
});

export const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/",
  component: CheckingScreen,
});

const signInSearchSchema = v.object({
  error: v.optional(v.picklist(["google_unreachable", "google_cancelled"])),
});

export const signInRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/sign-in",
  validateSearch: (search): v.InferOutput<typeof signInSearchSchema> =>
    v.parse(signInSearchSchema, search),
  component: SignInScreen,
});

const rejectedSearchSchema = v.object({
  email: v.optional(v.pipe(v.string(), v.email())),
});

export const rejectedRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/sign-in/rejected",
  validateSearch: (search): v.InferOutput<typeof rejectedSearchSchema> =>
    v.parse(rejectedSearchSchema, search),
  component: RejectedScreen,
});

export const welcomeRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/welcome",
  component: () => (
    <AuthGuard>
      <FirstArrivalScreen />
    </AuthGuard>
  ),
});

export const groceryRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/grocery",
  component: () => (
    <AuthGuard>
      <GroceryScreen />
    </AuthGuard>
  ),
});

export const recipesRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/recipes",
  component: () => (
    <AuthGuard>
      <RecipesScreen />
    </AuthGuard>
  ),
});

export const newRecipeRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/recipes/new",
  component: () => (
    <AuthGuard>
      <CreateRecipeScreen />
    </AuthGuard>
  ),
});

export const recipeDetailRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/recipes/$recipeId",
  component: () => {
    const { recipeId } = recipeDetailRoute.useParams();
    return (
      <AuthGuard>
        <RecipeDetailScreen recipeId={recipeId} />
      </AuthGuard>
    );
  },
});

export const editRecipeRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/recipes/$recipeId/edit",
  component: () => {
    const { recipeId } = editRecipeRoute.useParams();
    return (
      <AuthGuard>
        <EditRecipeScreen recipeId={recipeId} />
      </AuthGuard>
    );
  },
});

export const todoRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/todo",
  component: () => (
    <AuthGuard>
      <ProjectsScreen />
    </AuthGuard>
  ),
});

export const todoProjectRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/todo/$projectId",
  component: () => {
    const { projectId } = todoProjectRoute.useParams();
    return (
      <AuthGuard>
        <ProjectScreen projectId={projectId} />
      </AuthGuard>
    );
  },
});

export const appsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/apps",
  component: () => (
    <AuthGuard>
      <AppsScreen />
    </AuthGuard>
  ),
});

export const meRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/me",
  component: () => (
    <AuthGuard>
      <MeScreen />
    </AuthGuard>
  ),
});

const consentSearchSchema = v.object({
  client_id: v.optional(v.string()),
  scope: v.optional(v.string()),
  redirect_uri: v.optional(v.string()),
});

export const consentRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/consent",
  validateSearch: (search): v.InferOutput<typeof consentSearchSchema> =>
    v.parse(consentSearchSchema, search),
  component: ConsentScreen,
});

const routeTree = rootRoute.addChildren([
  indexRoute,
  signInRoute,
  rejectedRoute,
  welcomeRoute,
  groceryRoute,
  recipesRoute,
  newRecipeRoute,
  recipeDetailRoute,
  editRecipeRoute,
  todoRoute,
  todoProjectRoute,
  appsRoute,
  meRoute,
  consentRoute,
]);

export const router = createRouter({
  routeTree,
  defaultPreload: "intent",
});

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}
